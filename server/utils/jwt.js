/**
 * JWT Token Utilities
 * Used for bot mitigation after Turnstile verification
 */

import crypto from 'crypto';

// JWT expiration: 1 hour
const JWT_EXPIRATION = 60 * 60; // seconds

// Get or generate JWT secret
let jwtSecret = null;
function getJwtSecret() {
    if (!jwtSecret) {
        jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
        if (!process.env.JWT_SECRET) {
            console.log('⚠️ JWT_SECRET not set, using random secret (tokens won\'t persist across restarts)');
        }
    }
    return jwtSecret;
}

/**
 * Base64URL encode (JWT-safe)
 */
function base64UrlEncode(str) {
    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString();
}

/**
 * Generate a signed JWT token
 * @returns {string} JWT token valid for 1 hour
 */
export function generateJwtToken() {
    const secret = getJwtSecret();
    const now = Math.floor(Date.now() / 1000);

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        iat: now,
        exp: now + JWT_EXPIRATION,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));

    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded payload or null if invalid/expired
 */
export function verifyJwtToken(token) {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;

    try {
        const secret = getJwtSecret();

        // Verify signature
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(`${headerB64}.${payloadB64}`)
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        if (signature !== expectedSig) {
            return null;
        }

        // Decode and check expiration
        const payload = JSON.parse(base64UrlDecode(payloadB64));
        const now = Math.floor(Date.now() / 1000);

        if (payload.exp && payload.exp < now) {
            return null; // Token expired
        }

        return payload;
    } catch (e) {
        return null;
    }
}

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null
 */
export function extractTokenFromHeader(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

