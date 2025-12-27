/**
 * Alerts API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { CONFIG } from '../config.js';
import { heliusWS } from '../services/helius-ws.js';

const router = Router();

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

        if (!owner_wallet) {
            return res.status(400).json({ error: 'owner_wallet required' });
        }
        if (!label_id && !target_wallet) {
            return res.status(400).json({ error: 'Either label_id or target_wallet required' });
        }

        // Verify Pro status (or free mode)
        const proCheck = await pool.query(`
      SELECT 1 FROM payments
      WHERE wallet = $1 AND status = 'active' AND expires_at > NOW()
      LIMIT 1
    `, [owner_wallet]);

        if (proCheck.rows.length === 0 && !CONFIG.FREE_MODE) {
            return res.status(403).json({ error: 'Pro subscription required for alerts' });
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

        // Subscribe to wallet via Helius WebSocket
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

        res.json({ success: true, alert: result.rows[0] });
    } catch (error) {
        console.error('Create alert error:', error);
        res.status(500).json({ error: 'Failed to create alert' });
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

        // Verify ownership
        const existing = await pool.query('SELECT * FROM alert_settings WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        if (existing.rows[0].owner_wallet !== owner_wallet) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await pool.query('DELETE FROM alert_settings WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete alert error:', error);
        res.status(500).json({ error: 'Failed to delete alert' });
    }
});

export default router;

