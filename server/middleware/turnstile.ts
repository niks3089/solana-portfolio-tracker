import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config.js';
import { verifyJwtToken, extractTokenFromHeader, type JwtPayload } from '../utils/jwt.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const verifiedTokens = new Map<string, number>();
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [token, timestamp] of verifiedTokens) {
        if (now - timestamp > TOKEN_CACHE_TTL) verifiedTokens.delete(token);
    }
}, 60 * 1000);

type ValidateResult = {
    success: boolean;
    error?: string;
    errorCodes?: string[];
    data?: unknown;
    skipped?: boolean;
    cached?: boolean;
    failedOpen?: boolean;
};

type SiteverifyResp = { success: boolean; 'error-codes'?: string[] };

export async function validateTurnstileToken(
    token: string | undefined | null,
    remoteip: string | undefined,
): Promise<ValidateResult> {
    if (!CONFIG.TURNSTILE_SECRET_KEY) return { success: true, skipped: true };
    if (!token || typeof token !== 'string') return { success: false, error: 'missing-input-response' };
    if (token.length > 2048) return { success: false, error: 'invalid-input-response' };
    if (verifiedTokens.has(token)) return { success: true, cached: true };

    try {
        const response = await fetch(SITEVERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: CONFIG.TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: remoteip || '',
            }),
        });

        const result = (await response.json()) as SiteverifyResp;

        if (result.success) {
            verifiedTokens.set(token, Date.now());
            return { success: true, data: result };
        }

        return {
            success: false,
            error: result['error-codes']?.join(', ') || 'verification-failed',
            errorCodes: result['error-codes'] || [],
        };
    } catch (error) {
        console.error('Turnstile Siteverify error:', (error as Error).message);
        return { success: true, error: 'network-error', failedOpen: true };
    }
}

declare module 'express-serve-static-core' {
    interface Request {
        jwtPayload?: JwtPayload;
    }
}

export async function turnstileMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!CONFIG.TURNSTILE_SECRET_KEY) return next();

    const body = req.body as { 'cf-turnstile-response'?: string; turnstileToken?: string } | undefined;
    const token = (req.headers['x-turnstile-token'] as string | undefined) ||
        body?.['cf-turnstile-response'] || body?.turnstileToken;

    const remoteip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip) as string | undefined;
    const result = await validateTurnstileToken(token, remoteip);

    if (!result.success) {
        console.log(`🤖 Turnstile blocked: ${remoteip} | Error: ${result.error}`);
        res.status(403).json({
            success: false,
            error: 'Bot verification failed. Please refresh and try again.',
            code: 'TURNSTILE_FAILED',
            details: result.error,
        });
        return;
    }
    if (result.failedOpen) console.log(`⚠️ Turnstile verification failed, allowing request: ${remoteip}`);
    next();
}

export async function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!CONFIG.TURNSTILE_SECRET_KEY) return next();
    const token = extractTokenFromHeader(req.headers.authorization);
    if (!token) {
        res.status(401).json({ error: 'Authentication required', requiresTurnstile: true });
        return;
    }
    const payload = verifyJwtToken(token);
    if (!payload) {
        res.status(401).json({ error: 'Invalid or expired token', requiresTurnstile: true });
        return;
    }
    req.jwtPayload = payload;
    next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!CONFIG.TURNSTILE_SECRET_KEY) return next();
    const jwtToken = extractTokenFromHeader(req.headers.authorization);
    if (jwtToken) {
        const payload = verifyJwtToken(jwtToken);
        if (payload) {
            req.jwtPayload = payload;
            return next();
        }
    }
    res.status(401).json({ error: 'Authentication required', requiresTurnstile: true });
}
