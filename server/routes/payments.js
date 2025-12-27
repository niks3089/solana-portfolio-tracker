/**
 * Payment & Subscription API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { CONFIG, DISCOUNT_CODES } from '../config.js';

const router = Router();

// Get payment config
router.get('/payment-config', (req, res) => {
    res.json({
        wallet: CONFIG.PAYMENT_WALLET,
        amount: 1,
        originalAmount: 3,
        token: 'USDC',
        tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenDecimals: 6,
        durationDays: CONFIG.SUBSCRIPTION_DAYS,
        network: 'mainnet-beta',
        freeMode: CONFIG.FREE_MODE,
    });
});

// Get Pro status
router.get('/pro-status/:wallet', async (req, res) => {
    try {
        if (CONFIG.FREE_MODE) {
            return res.json({ isPro: true, freeMode: true });
        }

        const { wallet } = req.params;
        const result = await pool.query(
            `SELECT * FROM payments
       WHERE wallet = $1 AND status = 'active' AND expires_at > NOW()
       ORDER BY expires_at DESC LIMIT 1`,
            [wallet]
        );

        if (result.rows.length > 0) {
            res.json({
                isPro: true,
                expiresAt: result.rows[0].expires_at,
                paidAt: result.rows[0].paid_at,
            });
        } else {
            res.json({ isPro: false });
        }
    } catch (error) {
        console.error('Pro status error:', error);
        res.status(500).json({ error: 'Failed to check Pro status' });
    }
});

// Record a payment
router.post('/payments', async (req, res) => {
    try {
        const { wallet, tx_signature, amount, discount_code } = req.body;

        if (!wallet || !tx_signature) {
            return res.status(400).json({ error: 'wallet and tx_signature required' });
        }

        // Ensure user exists
        await pool.query(
            `INSERT INTO users (wallet) VALUES ($1) ON CONFLICT (wallet) DO UPDATE SET last_seen_at = NOW()`,
            [wallet]
        );

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + CONFIG.SUBSCRIPTION_DAYS);

        const result = await pool.query(
            `INSERT INTO payments (wallet, tx_signature, amount, expires_at, discount_code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tx_signature) DO NOTHING
       RETURNING *`,
            [wallet, tx_signature, amount || 1, expiresAt, discount_code]
        );

        if (result.rows.length === 0) {
            return res.status(409).json({ error: 'Payment already recorded' });
        }

        res.json({ success: true, payment: result.rows[0] });
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// Get payment history
router.get('/payments/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const result = await pool.query(
            `SELECT * FROM payments WHERE wallet = $1 ORDER BY paid_at DESC`,
            [wallet]
        );
        res.json({ payments: result.rows });
    } catch (error) {
        console.error('Payment history error:', error);
        res.status(500).json({ error: 'Failed to get payments' });
    }
});

// Check payment by wallet
router.get('/payments/check', async (req, res) => {
    try {
        const { wallet } = req.query;
        if (!wallet) {
            return res.status(400).json({ error: 'wallet required' });
        }
        const result = await pool.query(
            `SELECT * FROM payments WHERE wallet = $1 AND status = 'active' ORDER BY expires_at DESC`,
            [wallet]
        );
        res.json({ payments: result.rows });
    } catch (error) {
        console.error('Payment check error:', error);
        res.status(500).json({ error: 'Failed to check payments' });
    }
});

// Validate discount code
router.get('/discount/:code', (req, res) => {
    const { code } = req.params;
    const discount = DISCOUNT_CODES[code];

    if (discount !== undefined) {
        res.json({ valid: true, discount, code });
    } else {
        res.json({ valid: false });
    }
});

export default router;

