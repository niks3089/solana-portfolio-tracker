/**
 * Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';
import { metrics } from '../metrics.js';

// Connected users: 60 req/min
export const connectedLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { success: false, message: 'Too many requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `connected-${req.ip}`,
    handler: (req, res, next, options) => {
        metrics.rateLimited.connected++;
        res.status(options.statusCode).send(options.message);
    },
});

// Unconnected users: 6 req/10s
export const unconnectedLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 6,
    message: { success: false, message: 'Too many requests. Connect a wallet for higher limits.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `unconnected-${req.ip}`,
    handler: (req, res, next, options) => {
        metrics.rateLimited.unconnected++;
        res.status(options.statusCode).send(options.message);
    },
});

// Apply appropriate rate limit based on connection status
export function rateLimitMiddleware(req, res, next) {
    const isConnected = req.headers['x-connected-wallet'] ||
        req.query.wallet ||
        req.body?.owner_wallet ||
        (req.body?.wallets && req.body.wallets.length > 0);

    if (isConnected) {
        connectedLimiter(req, res, next);
    } else {
        unconnectedLimiter(req, res, next);
    }
}

