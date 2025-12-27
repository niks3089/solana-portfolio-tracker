/**
 * Dialect API Routes
 */

import { Router } from 'express';
import { CONFIG } from '../config.js';

const router = Router();
const DIALECT_APP_ID = 'ffb32fc6-5e32-47ba-acdf-3c77ce999360';

// Check if wallet is subscribed to Dialect
router.get('/check-subscription', async (req, res) => {
    try {
        const { wallet } = req.query;
        if (!wallet) {
            return res.status(400).json({ error: 'wallet required' });
        }

        const response = await fetch(
            `https://alerts-api.dial.to/v2/${DIALECT_APP_ID}/subscribers?walletAddress=${wallet}`,
            {
                headers: {
                    'x-dialect-api-key': CONFIG.DIALECT_API_KEY
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const subscribed = data.subscribers && data.subscribers.length > 0;
            res.json({ subscribed, count: data.count || 0 });
        } else {
            res.json({ subscribed: false, count: 0 });
        }
    } catch (error) {
        console.error('Dialect check error:', error);
        res.json({ subscribed: false, error: error.message });
    }
});

// Get subscriber count
router.get('/subscribers', async (req, res) => {
    try {
        const response = await fetch(
            `https://alerts-api.dial.to/v2/${DIALECT_APP_ID}/subscribers`,
            {
                headers: {
                    'x-dialect-api-key': CONFIG.DIALECT_API_KEY
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            res.json(data);
        } else {
            res.status(response.status).json({ error: 'Failed to get subscribers' });
        }
    } catch (error) {
        console.error('Dialect subscribers error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;

