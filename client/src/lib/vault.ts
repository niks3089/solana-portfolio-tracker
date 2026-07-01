// Client-side encrypted vault.
//
// Threat model:
//   - Operator (you) can SSH into the VM and dump SQLite → sees only AES-GCM
//     ciphertext + IV. No plaintext for portfolio names, wallet groupings,
//     snapshots.
//   - Anyone auditing the server source (server/vault.ts, server/routes/vault.ts)
//     can verify: no decryption code, no logging of plaintext, just opaque
//     bytes stored against `owner_wallet`.
//
// Key derivation:
//   1. App asks user's wallet to sign a deterministic challenge:
//      `solana-portfolio:vault:v1:<pubkey>`
//      Same wallet + same message = same signature (Phantom/Solflare/Backpack
//      all use ed25519 deterministic signing per RFC 8032). So the key is
//      stable across sessions without any server-side seed.
//   2. key = SHA-256(signature)  →  32-byte AES-256-GCM key
//   3. Cached in sessionStorage (cleared on tab close).
//
// Two things this does NOT hide (called out in the README too):
//   - The pubkey of the connecting user (it's the DB lookup key)
//   - Wallets you actively query (those go through Helius/Birdeye via the
//     server's API key; server logs see the addresses requested)

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
