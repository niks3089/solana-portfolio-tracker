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
const SESSION_KEY_NAME = 'vault.aesKey';

function challengeFor(wallet: string): Uint8Array {
    return new TextEncoder().encode(`solana-portfolio:vault:${KEY_VERSION}:${wallet}`);
}

// In-memory + session cache. We hold the CryptoKey in memory and a base58 of
// the raw key bytes in sessionStorage so a reload doesn't re-prompt.
let cachedKey: CryptoKey | null = null;

async function loadKeyFromSession(): Promise<CryptoKey | null> {
    if (cachedKey) return cachedKey;
    const raw = sessionStorage.getItem(SESSION_KEY_NAME);
    if (!raw) return null;
    try {
        const bytes = bs58.decode(raw);
        cachedKey = await crypto.subtle.importKey(
            'raw',
            bytes as BufferSource,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt'],
        );
        return cachedKey;
    } catch {
        sessionStorage.removeItem(SESSION_KEY_NAME);
        return null;
    }
}

async function persistKeyToSession(rawBytes: Uint8Array): Promise<void> {
    sessionStorage.setItem(SESSION_KEY_NAME, bs58.encode(rawBytes));
}

export function forgetVaultKey(): void {
    cachedKey = null;
    try { sessionStorage.removeItem(SESSION_KEY_NAME); } catch { /* ignore */ }
}

/**
 * Acquire the vault AES key for `wallet`. If cached in sessionStorage, returns
 * immediately. Otherwise prompts the wallet to sign the challenge (one popup).
 */
export async function ensureVaultKey(
    wallet: string,
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<CryptoKey> {
    const cached = await loadKeyFromSession();
    if (cached) return cached;
    const sig = await signMessage(challengeFor(wallet));
    const hashed = await crypto.subtle.digest('SHA-256', sig as BufferSource);
    await persistKeyToSession(new Uint8Array(hashed));
    cachedKey = await crypto.subtle.importKey('raw', hashed, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return cachedKey;
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
