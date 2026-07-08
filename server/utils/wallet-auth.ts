// Wallet-signature verification for the vault write path.
//
// Threat: without this, any Internet client that knows a wallet's base58
// pubkey can wipe that wallet's vault (a GET reveals `version`, a PUT with
// that version overwrites the row). Fix: require a wallet-signed challenge
// on unlock, issue a short-lived JWT bound to the wallet, require the JWT
// on PUT.
//
// The AUTH signature is intentionally separate from the AES-key-derivation
// signature (client/src/lib/vault.ts) — sending the AES-derivation
// signature to the server would let the server derive the AES key and
// break the confidentiality claim. So this is a distinct message.

import { createPublicKey, verify as cryptoVerify, timingSafeEqual, createHmac } from 'node:crypto';
import bs58 from 'bs58';

const CHALLENGE_MAX_AGE_SEC = 300;     // 5 minutes
const TOKEN_TTL_SEC = 24 * 60 * 60;    // 24 hours

// The message the client signs. Distinct namespace so a signature captured
// here can't be replayed against the AES-key-derivation challenge.
export function authChallenge(wallet: string, ts: number): string {
    return `solana-portfolio:vault-auth:v1:${wallet}:${ts}`;
}

function jwtSecret(): Buffer {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 32) {
        throw new Error('JWT_SECRET must be set to a random 32+ byte string');
    }
    return Buffer.from(s);
}

/**
 * Verify a Solana ed25519 signature over `message`. Returns false on any
 * malformed input rather than throwing — this runs on unauthenticated input.
 */
export function verifySolanaSignature(
    pubkeyBase58: string,
    message: Buffer,
    signatureBase58: string,
): boolean {
    try {
        const pubkey = bs58.decode(pubkeyBase58);
        const sig = bs58.decode(signatureBase58);
        if (pubkey.length !== 32 || sig.length !== 64) return false;
        // Wrap the raw 32-byte ed25519 key in SPKI DER for Node's crypto.
        const der = Buffer.concat([
            Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
            Buffer.from(pubkey),
        ]);
        const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
        return cryptoVerify(null, message, key, Buffer.from(sig));
    } catch {
        return false;
    }
}

/**
 * Verify the challenge-signature bundle sent to POST /api/vault/:wallet/session.
 * Enforces timestamp freshness so an intercepted signature is only briefly
 * usable, and rejects timestamps in the future (large clock skew from a
 * hostile client).
 */
export function verifyAuthChallenge(
    wallet: string,
    ts: number,
    signatureBase58: string,
): boolean {
    if (!Number.isFinite(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (ts > now + 60) return false;
    if (now - ts > CHALLENGE_MAX_AGE_SEC) return false;
    const msg = Buffer.from(authChallenge(wallet, ts), 'utf8');
    return verifySolanaSignature(wallet, msg, signatureBase58);
}

// --- Tokens (compact HS256 JWT, self-contained) --------------------------

function b64url(b: Buffer): string {
    return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(s: string): Buffer {
    let padded = s.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    return Buffer.from(padded, 'base64');
}

/** Issue a JWT tied to `wallet`, valid for TOKEN_TTL_SEC. */
export function issueVaultToken(wallet: string): { token: string; exp: number } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_TTL_SEC;
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = b64url(Buffer.from(JSON.stringify({ sub: wallet, iat: now, exp })));
    const sig = b64url(createHmac('sha256', jwtSecret()).update(`${header}.${payload}`).digest());
    return { token: `${header}.${payload}.${sig}`, exp };
}

/**
 * Verify a token and confirm its subject matches `wallet`. Returns true only
 * for valid, unexpired tokens whose `sub` equals `wallet`. Timing-safe
 * signature compare.
 */
export function verifyVaultToken(token: string | undefined, wallet: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts as [string, string, string];
    try {
        const expected = createHmac('sha256', jwtSecret()).update(`${header}.${payload}`).digest();
        const provided = fromB64url(sig);
        if (provided.length !== expected.length) return false;
        if (!timingSafeEqual(provided, expected)) return false;
        const p = JSON.parse(fromB64url(payload).toString('utf8')) as { sub?: string; exp?: number };
        if (!p.sub || p.sub !== wallet) return false;
        if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch {
        return false;
    }
}
