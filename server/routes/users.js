/**
 * Users API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// Create or update user on wallet connect
router.post('/', async (req, res) => {
    try {
        const { wallet } = req.body;
        if (!wallet) {
            return res.status(400).json({ error: 'wallet required' });
        }

        const result = await pool.query(
            `INSERT INTO users (wallet) VALUES ($1)
       ON CONFLICT (wallet) DO UPDATE SET last_seen_at = NOW()
       RETURNING *`,
            [wallet]
        );

        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('User creation error:', error);
        res.status(500).json({ error: 'Failed to create/update user' });
    }
});

// Get user info
router.get('/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const result = await pool.query('SELECT * FROM users WHERE wallet = $1', [wallet]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

export default router;

