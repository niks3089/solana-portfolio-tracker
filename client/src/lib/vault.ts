// Client-side encrypted vault.
//
// Two independent wallet signatures are used:
//
//   1. KEY-DERIVATION signature — `solana-portfolio:vault:v1:<pubkey>`
//      Deterministic. NEVER sent to the server. Hashed with SHA-256 to
//      produce the AES-256-GCM key. Cached in sessionStorage.
//
//   2. AUTH signature — `solana-portfolio:vault-auth:v1:<pubkey>:<ts>`
//      Timestamped, sent to the server (POST /api/vault/:wallet/session).
//      The server verifies with ed25519 and returns a 24h JWT bound to the
//      wallet. Required as `Authorization: Bearer` on PUT. The auth
//      signature does NOT let the server derive the AES key — it's a
//      distinct message.
//
// Threat model (see also README.md):
//   - Operator dumping SQLite → opaque AES-GCM ciphertext + IV.
//   - Operator MITMing writes → auth signature required, and even with a
//     captured auth signature the attacker gets 5 min of write ability at
//     most before the challenge expires. Reads remain opaque forever.
//   - Server compromise → attacker sees GET responses (opaque) and can
//     forge tokens (JWT_SECRET on the server), but the AES key never
//     touches the server, so ciphertext stays confidential.

import bs58 from 'bs58';

const KEY_VERSION = 'v1';
// Per-wallet cache key: otherwise switching wallets reads the previous
// wallet's key from sessionStorage and either mis-decrypts or leaks state.
const sessionKeyName = (wallet: string) => `vault.aesKey:${wallet}`;

function challengeFor(wallet: string): Uint8Array {
    return new TextEncoder().encode(`solana-portfolio:vault:${KEY_VERSION}:${wallet}`);
}

// In-memory cache keyed by wallet so switching wallets doesn't reuse the
// wrong key. Session storage does the same across reloads.
const cachedKeys = new Map<string, CryptoKey>();

async function loadKeyFromSession(wallet: string): Promise<CryptoKey | null> {
    const inMem = cachedKeys.get(wallet);
    if (inMem) return inMem;
    const raw = sessionStorage.getItem(sessionKeyName(wallet));
    if (!raw) return null;
    try {
        const bytes = bs58.decode(raw);
        const key = await crypto.subtle.importKey(
            'raw',
            bytes as BufferSource,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt'],
        );
        cachedKeys.set(wallet, key);
        return key;
    } catch {
        sessionStorage.removeItem(sessionKeyName(wallet));
        return null;
    }
}

async function persistKeyToSession(wallet: string, rawBytes: Uint8Array): Promise<void> {
    sessionStorage.setItem(sessionKeyName(wallet), bs58.encode(rawBytes));
}

/**
 * Acquire the vault AES key for `wallet`. If cached (memory or session),
 * returns immediately. Otherwise prompts the wallet to sign the challenge.
 */
export async function ensureVaultKey(
    wallet: string,
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<CryptoKey> {
    const cached = await loadKeyFromSession(wallet);
    if (cached) return cached;
    const sig = await signMessage(challengeFor(wallet));
    const hashed = await crypto.subtle.digest('SHA-256', sig as BufferSource);
    await persistKeyToSession(wallet, new Uint8Array(hashed));
    const key = await crypto.subtle.importKey('raw', hashed, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    cachedKeys.set(wallet, key);
    return key;
}

// --- Auth token (JWT from the server) ---

const sessionTokenName = (wallet: string) => `vault.token:${wallet}`;
const cachedTokens = new Map<string, { token: string; exp: number }>();

function readTokenFromSession(wallet: string): { token: string; exp: number } | null {
    const inMem = cachedTokens.get(wallet);
    if (inMem && inMem.exp > Math.floor(Date.now() / 1000) + 30) return inMem;
    try {
        const raw = sessionStorage.getItem(sessionTokenName(wallet));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { token: string; exp: number };
        if (!parsed?.token || !parsed?.exp) return null;
        if (parsed.exp <= Math.floor(Date.now() / 1000) + 30) return null;
        cachedTokens.set(wallet, parsed);
        return parsed;
    } catch { return null; }
}

function writeTokenToSession(wallet: string, token: string, exp: number): void {
    cachedTokens.set(wallet, { token, exp });
    try { sessionStorage.setItem(sessionTokenName(wallet), JSON.stringify({ token, exp })); } catch { /* quota */ }
}

/**
 * Return a valid server-issued token for `wallet`, prompting the wallet to
 * sign the AUTH challenge if we don't already have a fresh token cached.
 * The signed message is distinct from the AES-key challenge.
 */
export async function ensureVaultToken(
    wallet: string,
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
    const cached = readTokenFromSession(wallet);
    if (cached) return cached.token;

    const ts = Math.floor(Date.now() / 1000);
    const msg = new TextEncoder().encode(`solana-portfolio:vault-auth:${KEY_VERSION}:${wallet}:${ts}`);
    const sig = await signMessage(msg);
    const signatureBase58 = bs58.encode(sig);

    const res = await fetch(`/api/vault/${wallet}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts, signature: signatureBase58 }),
    });
    if (!res.ok) throw new Error(`vault session failed: ${res.status}`);
    const body = (await res.json()) as { token: string; exp: number };
    writeTokenToSession(wallet, body.token, body.exp);
    return body.token;
}

export type EncryptedBlob = { ciphertext: string; iv: string };

export async function encryptJson(key: CryptoKey, data: unknown): Promise<EncryptedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(data));
    const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource),
    );
    return { ciphertext: bytesToB64(ct), iv: bytesToB64(iv) };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
    const iv = b64ToBytes(blob.iv);
    const ct = b64ToBytes(blob.ciphertext);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ct as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
}

function bytesToB64(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
    return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
