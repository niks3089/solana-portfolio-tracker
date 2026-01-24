/**
 * Alerts API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { CONFIG } from '../config.js';
import { heliusWS } from '../services/helius-ws.js';
import { authMiddleware } from '../middleware/turnstile.js';

const router = Router();

// Dialect API credentials
const DIALECT_CLIENT_KEY = CONFIG.DIALECT_CLIENT_KEY || 'pk_rjryqg4hkgb4tbxrhau62sdq';
const DIALECT_API_KEY = CONFIG.DIALECT_API_KEY || 'sk_uv96kdjlybayt1va0cb0cj5o';

// Step 1: Prepare Dialect auth - get message to sign
router.post('/dialect/auth/prepare', async (req, res) => {
    try {
        const { wallet } = req.body;
        if (!wallet) {
            return res.status(400).json({ error: 'wallet required' });
        }

        console.log(`Preparing Dialect auth for ${wallet.slice(0, 8)}...`);

        const response = await fetch('https://alerts-api.dial.to/v2/auth/solana/prepare', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dialect-Client-Key': DIALECT_CLIENT_KEY,
            },
            body: JSON.stringify({ walletAddress: wallet })
        });

        const data = await response.json().catch(() => ({}));
        console.log('Dialect auth prepare response:', response.status, JSON.stringify(data).slice(0, 200));

        if (response.ok && data.message) {
            return res.json({ message: data.message });
        } else {
            return res.status(response.status).json({ error: data.message || 'Failed to prepare auth' });
        }
    } catch (error) {
        console.error('Dialect auth prepare error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Step 2: Verify Dialect auth - exchange signature for JWT
router.post('/dialect/auth/verify', async (req, res) => {
    try {
        const { wallet, signature, signedMessage } = req.body;
        if (!wallet || !signature || !signedMessage) {
            return res.status(400).json({ error: 'wallet, signature, and signedMessage required' });
        }

        console.log(`Verifying Dialect auth for ${wallet.slice(0, 8)}...`);

        // Convert signature array to base58
        const bs58 = await import('bs58');
        const signatureBase58 = bs58.default.encode(new Uint8Array(signature));

        const response = await fetch('https://alerts-api.dial.to/v2/auth/solana/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dialect-Client-Key': DIALECT_CLIENT_KEY,
            },
            body: JSON.stringify({
                walletAddress: wallet,
                signature: signatureBase58,
                signedMessage: signedMessage
            })
        });

        const data = await response.json().catch(() => ({}));
        console.log('Dialect auth verify response:', response.status, data.token ? 'got token' : JSON.stringify(data).slice(0, 200));

        if (response.ok && data.token) {
            return res.json({ token: data.token });
        } else {
            return res.status(response.status).json({ error: data.message || 'Failed to verify auth' });
        }
    } catch (error) {
        console.error('Dialect auth verify error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Prepare Telegram channel - returns verification link
router.post('/telegram/prepare', async (req, res) => {
    try {
        const { subscriberToken } = req.body;

        if (!subscriberToken) {
            return res.status(400).json({ error: 'subscriberToken required' });
        }

        console.log('Preparing Telegram channel...');

        const response = await fetch('https://alerts-api.dial.to/v2/channel/telegram/prepare', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dialect-Client-Key': DIALECT_CLIENT_KEY,
                'Authorization': `Bearer ${subscriberToken}`,
            }
        });

        const data = await response.json().catch(() => ({}));
        console.log('Dialect prepare response:', response.status, JSON.stringify(data));

        if (response.ok) {
            return res.json({
                success: true,
                verified: data.verified,
                link: data.verification?.link,
                channel: data
            });
        } else {
            return res.status(response.status).json({
                error: data.message || data.error || 'Failed to prepare Telegram',
                details: data
            });
        }
    } catch (error) {
        console.error('Telegram prepare error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Check Telegram channel status
router.post('/telegram/status', async (req, res) => {
    try {
        const { subscriberToken } = req.body;

        if (!subscriberToken) {
            return res.status(400).json({ error: 'subscriberToken required' });
        }

        const response = await fetch('https://alerts-api.dial.to/v2/channels', {
            method: 'GET',
            headers: {
                'X-Dialect-Client-Key': DIALECT_CLIENT_KEY,
                'Authorization': `Bearer ${subscriberToken}`,
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            const telegram = Array.isArray(data)
                ? data.find(c => c.type === 'TELEGRAM')
                : data.channels?.find(c => c.type === 'TELEGRAM');

            return res.json({
                success: true,
                verified: telegram?.verified || false,
                channel: telegram
            });
        } else {
            return res.status(response.status).json({
                error: data.message || 'Failed to get channels',
                details: data
            });
        }
    } catch (error) {
        console.error('Telegram status error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Store pending verification codes (in-memory, resets on restart)
const pendingCodes = new Map();

// Store wallets that initiated verification (to track who messaged the bot)
const pendingVerifications = new Map();

// Prepare verification - mark wallet as pending
router.post('/telegram/prepare-verify', async (req, res) => {
    const { wallet, username } = req.body;
    if (wallet) {
        pendingVerifications.set(wallet, { 
            username, 
            startedAt: Date.now(),
            verified: false 
        });
    }
    res.json({ success: true });
});

// Check if Telegram is verified
// Since we can't validate Dialect bot codes directly, we check:
// 1. User initiated verification (clicked Submit)
// 2. Code is valid 6-digit format
// 3. Send test notification - if they set up correctly, they'll receive it
router.post('/telegram/check-verified', async (req, res) => {
    try {
        const { wallet, code, username } = req.body;

        if (!wallet || !code) {
            return res.status(400).json({ error: 'wallet and code required' });
        }

        // Validate code format (must be 6 digits from Dialect bot)
        if (!/^\d{6}$/.test(code.trim())) {
            return res.status(400).json({ verified: false, error: `Incorrect verification code ${code}` });
        }

        // Check if user initiated verification
        const pending = pendingVerifications.get(wallet);
        if (!pending) {
            return res.status(400).json({ verified: false, error: `Incorrect verification code ${code}` });
        }

        // Check if verification started recently (within 10 minutes)
        if (Date.now() - pending.startedAt > 10 * 60 * 1000) {
            pendingVerifications.delete(wallet);
            return res.status(400).json({ verified: false, error: 'Verification expired. Click Submit again.' });
        }

        console.log(`✓ Telegram verified for ${wallet.slice(0, 8)}... with code ${code}`);
        pendingVerifications.delete(wallet);

        // Store username
        if (username) {
            await pool.query(`
                UPDATE users SET telegram_username = $1 WHERE wallet = $2
            `, [username.replace('@', ''), wallet]).catch(() => { });
        }

        // Send confirmation notification
        try {
            const { sendNotification } = await import('../services/dialect-sdk.js');
            await sendNotification({
                recipient: wallet,
                title: '✅ Telegram Connected',
                body: `Your Telegram (@${username || 'user'}) is now connected to Portfolio notifications!`,
            });
        } catch (e) { }

        return res.json({ verified: true });
    } catch (error) {
        console.error('Check verified error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Send verification code to Telegram
router.post('/telegram/send-code', async (req, res) => {
    try {
        const { wallet, username } = req.body;

        if (!wallet) {
            return res.status(400).json({ error: 'wallet required' });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Store with 10 minute expiry
        pendingCodes.set(wallet, {
            code,
            username,
            expires: Date.now() + 10 * 60 * 1000
        });

        console.log(`Generated verification code ${code} for ${wallet.slice(0, 8)}...`);

        // Send code via Dialect notification
        const { sendNotification } = await import('../services/dialect-sdk.js');
        const success = await sendNotification({
            recipient: wallet,
            title: '🔐 Verification Code',
            body: `Your Portfolio verification code is: ${code}\n\nEnter this code in the app to connect your Telegram.`,
        });

        if (success) {
            return res.json({ success: true, message: 'Code sent to your Telegram' });
        } else {
            pendingCodes.delete(wallet);
            return res.status(400).json({ error: 'Failed to send code. Make sure your Telegram is linked.' });
        }
    } catch (error) {
        console.error('Send code error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Verify the code user entered
router.post('/telegram/verify-code', async (req, res) => {
    try {
        const { wallet, code, username } = req.body;

        if (!wallet || !code) {
            return res.status(400).json({ error: 'wallet and code required' });
        }

        const pending = pendingCodes.get(wallet);

        if (!pending) {
            return res.status(400).json({ error: `Incorrect verification code ${code}` });
        }

        if (Date.now() > pending.expires) {
            pendingCodes.delete(wallet);
            return res.status(400).json({ error: 'Code expired. Click Submit to get a new code.' });
        }

        if (pending.code !== code.trim()) {
            console.log(`Code mismatch for ${wallet.slice(0, 8)}...: expected ${pending.code}, got ${code}`);
            return res.status(400).json({ error: `Incorrect verification code ${code}` });
        }

        // Code matches!
        pendingCodes.delete(wallet);
        console.log(`✓ Telegram verified for ${wallet.slice(0, 8)}...`);

        // Store username in database
        if (username) {
            await pool.query(`
                UPDATE users SET telegram_username = $1 WHERE wallet = $2
            `, [username.replace('@', ''), wallet]).catch(() => { });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Verify code error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Test Telegram connection by sending a test notification
router.post('/telegram/test', async (req, res) => {
    try {
        const { wallet, code, username } = req.body;

        if (!wallet || !code) {
            return res.status(400).json({ error: 'wallet and code required' });
        }

        // Validate code format (6 digits)
        if (!/^\d{6}$/.test(code.trim())) {
            return res.status(400).json({ error: `Incorrect verification code ${code}` });
        }

        console.log(`Testing Telegram for ${wallet.slice(0, 8)}... with code ${code}`);

        // Import and use the Dialect notification service
        const { sendNotification } = await import('../services/dialect-sdk.js');

        // Send a test notification
        const success = await sendNotification({
            recipient: wallet,
            title: '✅ Telegram Connected!',
            body: `Your Telegram (@${username || 'user'}) is now connected to Portfolio notifications.\n\nVerification code: ${code}`,
        });

        if (success) {
            // Store username in database
            await pool.query(`
                UPDATE users SET telegram_username = $1 WHERE wallet = $2
            `, [username?.replace('@', '') || null, wallet]).catch(() => { });

            console.log(`✓ Test notification sent to ${wallet.slice(0, 8)}...`);
            return res.json({ success: true });
        } else {
            return res.status(400).json({ error: 'Failed to send test notification. Check your Telegram connection.' });
        }
    } catch (error) {
        console.error('Telegram test error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Legacy verify endpoint - validate code format
router.post('/telegram/verify', async (req, res) => {
    try {
        const { wallet, code, username } = req.body;

        if (!wallet || !code) {
            return res.status(400).json({ error: 'wallet and code required' });
        }

        // Validate code format (6 digits from Dialect bot)
        const cleanCode = code.trim();
        if (!/^\d{6}$/.test(cleanCode)) {
            console.log(`✗ Invalid code format: ${cleanCode}`);
            return res.status(400).json({ error: `Incorrect verification code ${cleanCode}` });
        }

        console.log(`✓ Telegram verified for ${wallet.slice(0, 8)}... (code: ${cleanCode})`);

        // Store the telegram username in the user's record for future reference
        if (username) {
            await pool.query(`
                UPDATE users SET telegram_username = $1 WHERE wallet = $2
            `, [username.replace('@', ''), wallet]).catch(() => { });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Telegram verify error:', error.message);
        res.status(500).json({ error: 'Verification failed: ' + error.message });
    }
});

// Require JWT for all other alert routes
router.use(authMiddleware);

// Get all alerts for a wallet
router.get('/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const result = await pool.query(`
      SELECT a.*, l.name as label_name
      FROM alert_settings a
      LEFT JOIN labels l ON a.label_id = l.id
      WHERE a.owner_wallet = $1
      ORDER BY a.created_at DESC
    `, [wallet]);
        res.json({ alerts: result.rows });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({ error: 'Failed to get alerts' });
    }
});

// Create a new alert
router.post('/', async (req, res) => {
    try {
        const { owner_wallet, label_id, target_wallet, telegram_username, alert_type, threshold_percent } = req.body;

        console.log('Creating alert:', { owner_wallet: owner_wallet?.slice(0, 8), label_id, target_wallet: target_wallet?.slice(0, 8), alert_type });

        if (!owner_wallet) {
            return res.status(400).json({ error: 'owner_wallet required' });
        }
        if (!label_id && !target_wallet) {
            return res.status(400).json({ error: 'Either label_id or target_wallet required' });
        }

        // Ensure user exists (auto-create if not)
        await pool.query(`
            INSERT INTO users (wallet) VALUES ($1)
            ON CONFLICT (wallet) DO NOTHING
        `, [owner_wallet]);

        // Verify Pro status (or free mode)
        const proCheck = await pool.query(`
      SELECT 1 FROM payments
      WHERE wallet = $1 AND status = 'active' AND expires_at > NOW()
      LIMIT 1
    `, [owner_wallet]);

        if (proCheck.rows.length === 0 && !CONFIG.FREE_MODE) {
            return res.status(403).json({ error: 'Pro subscription required for alerts' });
        }

        // Check for duplicate alert
        const existing = await pool.query(`
            SELECT id FROM alert_settings
            WHERE owner_wallet = $1
              AND COALESCE(label_id, 0) = COALESCE($2, 0)
              AND COALESCE(target_wallet, '') = COALESCE($3, '')
              AND alert_type = $4
            LIMIT 1
        `, [owner_wallet, label_id || null, target_wallet || null, alert_type || 'any_tx']);

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Alert already exists for this configuration' });
        }

        const result = await pool.query(`
      INSERT INTO alert_settings (owner_wallet, label_id, target_wallet, telegram_username, alert_type, threshold_percent, enabled)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `, [
            owner_wallet,
            label_id || null,
            target_wallet || null,
            telegram_username || null,
            alert_type || 'any_tx',
            threshold_percent || 5.00
        ]);

        console.log('Alert created:', result.rows[0]?.id);

        // Subscribe to wallet via Helius WebSocket
        try {
            if (target_wallet) {
                heliusWS.subscribeToWallet(target_wallet);
            } else if (label_id) {
                const label = await pool.query('SELECT wallets FROM labels WHERE id = $1', [label_id]);
                if (label.rows[0]?.wallets) {
                    for (const w of label.rows[0].wallets) {
                        heliusWS.subscribeToWallet(w.address);
                    }
                }
            }
        } catch (wsError) {
            console.error('WebSocket subscription error (non-fatal):', wsError.message);
        }

        res.json({ success: true, alert: result.rows[0] });
    } catch (error) {
        console.error('Create alert error:', error.message);
        res.status(500).json({ error: 'Failed to create alert: ' + error.message });
    }
});

// Update an alert
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { owner_wallet, enabled, telegram_username, alert_type, threshold_percent } = req.body;

        // Verify ownership
        const existing = await pool.query('SELECT * FROM alert_settings WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        if (existing.rows[0].owner_wallet !== owner_wallet) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const result = await pool.query(`
      UPDATE alert_settings
      SET enabled = COALESCE($1, enabled),
          telegram_username = COALESCE($2, telegram_username),
          alert_type = COALESCE($3, alert_type),
          threshold_percent = COALESCE($4, threshold_percent),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [enabled, telegram_username, alert_type, threshold_percent, id]);

        res.json({ success: true, alert: result.rows[0] });
    } catch (error) {
        console.error('Update alert error:', error);
        res.status(500).json({ error: 'Failed to update alert' });
    }
});

// Delete an alert
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { owner_wallet } = req.body;

        console.log('Deleting alert:', { id, owner_wallet: owner_wallet?.slice(0, 8) });

        // Verify ownership
        const existing = await pool.query('SELECT * FROM alert_settings WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        if (owner_wallet && existing.rows[0].owner_wallet !== owner_wallet) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await pool.query('DELETE FROM alert_settings WHERE id = $1', [id]);
        console.log('Alert deleted:', id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete alert error:', error.message);
        res.status(500).json({ error: 'Failed to delete alert: ' + error.message });
    }
});

export default router;

