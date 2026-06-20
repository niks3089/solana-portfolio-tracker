import crypto from 'crypto';

const JWT_EXPIRATION = 60 * 60;

let jwtSecret: string | null = null;
function getJwtSecret(): string {
    if (!jwtSecret) {
        jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
        if (!process.env.JWT_SECRET) {
            console.log("⚠️ JWT_SECRET not set, using random secret (tokens won't persist across restarts)");
        }
    }
    return jwtSecret;
}

function base64UrlEncode(str: string): string {
    return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): string {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64').toString();
}

export function generateJwtToken(): string {
    const secret = getJwtSecret();
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadB64 = base64UrlEncode(JSON.stringify({ iat: now, exp: now + JWT_EXPIRATION }));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `${headerB64}.${payloadB64}.${signature}`;
}

export type JwtPayload = { iat: number; exp: number };

export function verifyJwtToken(token: string | null | undefined): JwtPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signature] = parts as [string, string, string];

    try {
        const secret = getJwtSecret();
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(`${headerB64}.${payloadB64}`)
            .digest('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        if (signature !== expectedSig) return null;
        const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return null;
        return payload;
    } catch {
        return null;
    }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    return authHeader.substring(7);
}
