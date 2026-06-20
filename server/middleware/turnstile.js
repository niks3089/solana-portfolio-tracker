/**
 * Cloudflare Turnstile Verification + JWT Auth Middleware
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

import { CONFIG } from '../config.js';
import { verifyJwtToken, extractTokenFromHeader } from '../utils/jwt.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cache verified tokens (tokens are single-use, but cache for idempotency)
const verifiedTokens = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (token lifetime)

// Cleanup expired tokens periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, timestamp] of verifiedTokens) {
        if (now - timestamp > TOKEN_CACHE_TTL) {
            verifiedTokens.delete(token);
        }
    }
}, 60 * 1000);

/**
 * Validate Turnstile token with Cloudflare Siteverify API
 * @param {string} token - The cf-turnstile-response token from client
 * @param {string} remoteip - Client IP address
 * @returns {Promise<{success: boolean, error?: string, data?: object}>}
 */
async function validateTurnstileToken(token, remoteip) {
    // Skip if Turnstile not configured
    if (!CONFIG.TURNSTILE_SECRET_KEY) {
        return { success: true, skipped: true };
    }

    // Validate token format
    if (!token || typeof token !== 'string') {
        return { success: false, error: 'missing-input-response' };
    }

    if (token.length > 2048) {
        return { success: false, error: 'invalid-input-response' };
    }

    // Check cache (for idempotent retries)
    if (verifiedTokens.has(token)) {
        return { success: true, cached: true };
    }

    try {
        // Use form-urlencoded as recommended by Cloudflare
        const response = await fetch(SITEVERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                secret: CONFIG.TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: remoteip || '',
            }),
        });

        const result = await response.json();

        /*
        Response format:
        {
            "success": true|false,
            "challenge_ts": "2022-02-28T15:14:30.096Z",
            "hostname": "example.com",
            "error-codes": [],
            "action": "login",
            "cdata": "sessionid-123456789"
        }
        */

        if (result.success) {
            // Cache successful validation (token is single-use anyway)
            verifiedTokens.set(token, Date.now());
            return { success: true, data: result };
        }

        // Return error codes from Cloudflare
        return {
            success: false,
            error: result['error-codes']?.join(', ') || 'verification-failed',
            errorCodes: result['error-codes'] || [],
        };

    } catch (error) {
        console.error('Turnstile Siteverify error:', error.message);
        // Fail open on network errors to not block legitimate users
        return { success: true, error: 'network-error', failedOpen: true };
    }
}

/**
 * Express middleware to verify Turnstile token
 * Blocks requests with invalid/missing tokens
 */
export async function turnstileMiddleware(req, res, next) {
    // Skip if Turnstile not configured
    if (!CONFIG.TURNSTILE_SECRET_KEY) {
        return next();
    }

    // Get token from header (preferred) or body
    const token = req.headers['x-turnstile-token'] ||
                  req.body?.['cf-turnstile-response'] ||
                  req.body?.turnstileToken;

    // Get client IP (Cloudflare headers take priority)
    const remoteip = req.headers['cf-connecting-ip'] ||
                     req.headers['x-real-ip'] ||
                     req.ip;

    const result = await validateTurnstileToken(token, remoteip);

    if (!result.success) {
        console.log(`🤖 Turnstile blocked: ${remoteip} | Error: ${result.error}`);
        return res.status(403).json({
            success: false,
            error: 'Bot verification failed. Please refresh and try again.',
            code: 'TURNSTILE_FAILED',
            details: result.error,
        });
    }

    if (result.failedOpen) {
        console.log(`⚠️ Turnstile verification failed, allowing request: ${remoteip}`);
    }

    next();
}

/**
 * Monitoring middleware - logs but doesn't block
 * Use this first to see how many requests would be blocked
 */
export async function turnstileMonitorMiddleware(req, res, next) {
    if (!CONFIG.TURNSTILE_SECRET_KEY) {
        return next();
    }

    const token = req.headers['x-turnstile-token'] ||
                  req.body?.['cf-turnstile-response'];
    const remoteip = req.headers['cf-connecting-ip'] ||
                     req.headers['x-real-ip'] ||
                     req.ip;

    const result = await validateTurnstileToken(token, remoteip);

    if (!result.success && !result.skipped) {
        console.log(`⚠️ Turnstile WOULD block: ${remoteip} | ${req.path} | Error: ${result.error}`);
    }

    // Always continue (monitoring only)
    next();
}

/**
 * JWT Authentication Middleware
 * Protects routes - requires valid JWT from Turnstile verification
 */
export async function jwtAuthMiddleware(req, res, next) {
    // Skip if Turnstile not configured
    if (!CONFIG.TURNSTILE_SECRET_KEY) {
        return next();
    }

    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            requiresTurnstile: true,
        });
    }

    const payload = verifyJwtToken(token);

    if (!payload) {
        return res.status(401).json({
            error: 'Invalid or expired token',
            requiresTurnstile: true,
        });
    }

    // Token is valid
    req.jwtPayload = payload;
    next();
}

/**
 * Combined middleware - checks JWT first, falls back to Turnstile token check
 * More lenient - allows either JWT or fresh Turnstile token
 */
export async function authMiddleware(req, res, next) {
    // Skip if Turnstile not configured
    if (!CONFIG.TURNSTILE_SECRET_KEY) {
        return next();
    }

    // Check for JWT first
    const authHeader = req.headers.authorization;
    const jwtToken = extractTokenFromHeader(authHeader);

    if (jwtToken) {
        const payload = verifyJwtToken(jwtToken);
        if (payload) {
            req.jwtPayload = payload;
            return next();
        }
    }

    // No valid JWT - require Turnstile verification to get one
    return res.status(401).json({
        error: 'Authentication required',
        requiresTurnstile: true,
    });
}

export { validateTurnstileToken };
