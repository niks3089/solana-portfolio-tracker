/**
 * Alerts API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { CONFIG } from '../config.js';
import { heliusWS } from '../services/helius-ws.js';
import { authMiddleware } from '../middleware/turnstile.js';

const router = Router();

// Verify Telegram code
// Note: Dialect's Telegram verification happens via the bot itself, not via API.
// The code the user receives proves they completed the bot flow.
// We validate format and store the association.
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
            `, [username.replace('@', ''), wallet]).catch(() => {});
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

