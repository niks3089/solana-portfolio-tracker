// Vault endpoints — encrypted-at-rest portfolio storage.
//
// Server contract:
//   GET  /api/vault/:wallet  -> { ciphertext, iv, version } | 404
//   PUT  /api/vault/:wallet  -> { ok: true, version } | 409 { conflict: { version, ... } }
//
// The server never decrypts. Anyone reading the SQLite file directly sees
// random bytes. The decryption key lives only in the user's browser, derived
// from a wallet signature (see client/src/lib/vault.ts).

import { Router, type Request, type Response } from 'express';
import { getVault, putVault } from '../vault.js';

const router = Router();

// Helpers — base64 ↔ Buffer. We accept and return base64 strings so the JSON
// payload stays clean.
function b64ToBuffer(s: unknown): Buffer | null {
    if (typeof s !== 'string') return null;
    try { return Buffer.from(s, 'base64'); } catch { return null; }
}
function bufferToB64(b: Buffer): string {
    return b.toString('base64');
}

// Basic wallet-pubkey sanity check — Solana addresses are base58, 32–44 chars.
function isPlausibleWallet(s: string): boolean {
    return typeof s === 'string' && s.length >= 32 && s.length <= 64 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

router.get('/:wallet', (req: Request<{ wallet: string }>, res: Response): void => {
    const owner = req.params.wallet;
    if (!isPlausibleWallet(owner)) {
        res.status(400).json({ error: 'invalid wallet' });
        return;
    }
    const row = getVault(owner);
    if (!row) {
        res.status(404).json({ error: 'no vault' });
        return;
    }
    res.json({
        ciphertext: bufferToB64(row.ciphertext),
        iv: bufferToB64(row.iv),
        version: row.version,
        updated_at: row.updated_at,
    });
});

router.put('/:wallet', (req: Request<{ wallet: string }>, res: Response): void => {
    const owner = req.params.wallet;
    if (!isPlausibleWallet(owner)) {
        res.status(400).json({ error: 'invalid wallet' });
        return;
    }
    const body = req.body as { ciphertext?: string; iv?: string; version?: number } | undefined;
    const ciphertext = b64ToBuffer(body?.ciphertext);
    const iv = b64ToBuffer(body?.iv);
    const expectedVersion = Number(body?.version ?? 0);
    if (!ciphertext || !iv || !Number.isFinite(expectedVersion)) {
        res.status(400).json({ error: 'ciphertext, iv (base64), version required' });
        return;
    }
    // Refuse implausibly large blobs (1 MB). Real vaults are <100 KB.
    if (ciphertext.length > 1_000_000) {
        res.status(413).json({ error: 'blob too large' });
        return;
    }
    if (iv.length !== 12) {
        res.status(400).json({ error: 'iv must be 12 bytes (AES-GCM nonce)' });
        return;
    }

    const result = putVault(owner, ciphertext, iv, expectedVersion);
    if (!result.ok) {
        res.status(409).json({
            error: 'version conflict',
            conflict: {
                ciphertext: bufferToB64(result.conflict.ciphertext),
                iv: bufferToB64(result.conflict.iv),
                version: result.conflict.version,
                updated_at: result.conflict.updated_at,
            },
        });
        return;
    }
    res.json({ ok: true, version: result.version });
});

export default router;
