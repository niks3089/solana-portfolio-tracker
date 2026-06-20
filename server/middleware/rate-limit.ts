import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { metrics } from '../metrics.js';

export const connectedLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { success: false, message: 'Too many requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `connected-${req.ip}`,
    handler: (req, res, _next, options) => {
        metrics.rateLimited.connected++;
        res.status(options.statusCode).send(options.message);
    },
});

export const unconnectedLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 6,
    message: { success: false, message: 'Too many requests. Connect a wallet for higher limits.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `unconnected-${req.ip}`,
    handler: (req, res, _next, options) => {
        metrics.rateLimited.unconnected++;
        res.status(options.statusCode).send(options.message);
    },
});

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const body = req.body as { owner_wallet?: string; wallets?: unknown[] } | undefined;
    const isConnected =
        req.headers['x-connected-wallet'] ||
        req.query.wallet ||
        body?.owner_wallet ||
        (body?.wallets && body.wallets.length > 0);

    if (isConnected) connectedLimiter(req, res, next);
    else unconnectedLimiter(req, res, next);
}
