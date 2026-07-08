// Vault endpoints — encrypted-at-rest portfolio storage.
//
//   GET  /api/vault/:wallet          -> { ciphertext, iv, version } | 404
//   POST /api/vault/:wallet/session  -> { token, exp }  (requires signed challenge)
//   PUT  /api/vault/:wallet          -> { ok, version } | 409 { version }
//                                       requires Authorization: Bearer <token>
//
// The server never decrypts. Anyone reading the SQLite file directly sees
// random bytes. The decryption key lives only in the user's browser
// (see client/src/lib/vault.ts). The PUT-auth token binds writes to a wallet
// signature but has NO ability to read plaintext.

import { Router, type Request, type Response } from 'express';
import { getVault, putVault } from '../vault.js';
import { issueVaultToken, verifyAuthChallenge, verifyVaultToken } from '../utils/wallet-auth.js';

const router = Router();

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isPlausibleWallet = (s: string): boolean => WALLET_RE.test(s);
const b64ToBuf = (s: unknown): Buffer | null =>
    typeof s === 'string' ? Buffer.from(s, 'base64') : null;

router.get('/:wallet', (req: Request<{ wallet: string }>, res: Response): void => {
    const owner = req.params.wallet;
    if (!isPlausibleWallet(owner)) { res.status(400).json({ error: 'invalid wallet' }); return; }
    const row = getVault(owner);
    if (!row) { res.status(404).json({ error: 'no vault' }); return; }
    res.json({
        ciphertext: row.ciphertext.toString('base64'),
        iv: row.iv.toString('base64'),
        version: row.version,
        updated_at: row.updated_at,
    });
});

// Signed-challenge → session token. Client signs
// `solana-portfolio:vault-auth:v1:<wallet>:<ts>` with the wallet's ed25519
// key; we verify against the URL pubkey and issue a 24h JWT bound to that
// wallet. This challenge is DIFFERENT from the AES-key-derivation challenge
// on the client — that one is never sent to the server.
router.post('/:wallet/session', (req: Request<{ wallet: string }>, res: Response): void => {
    const owner = req.params.wallet;
    if (!isPlausibleWallet(owner)) { res.status(400).json({ error: 'invalid wallet' }); return; }
    const body = req.body as { ts?: number; signature?: string } | undefined;
    const ts = Number(body?.ts);
    const signature = typeof body?.signature === 'string' ? body.signature : '';
    if (!Number.isFinite(ts) || !signature) {
        res.status(400).json({ error: 'ts and signature required' }); return;
    }
    if (!verifyAuthChallenge(owner, ts, signature)) {
        res.status(401).json({ error: 'invalid signature' }); return;
    }
    const { token, exp } = issueVaultToken(owner);
    res.json({ token, exp });
});

router.put('/:wallet', (req: Request<{ wallet: string }>, res: Response): void => {
    const owner = req.params.wallet;
    if (!isPlausibleWallet(owner)) { res.status(400).json({ error: 'invalid wallet' }); return; }

    // Auth: Bearer token bound to `owner`.
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyVaultToken(token, owner)) {
        res.status(401).json({ error: 'auth required — POST /session first' });
        return;
    }

    const body = req.body as { ciphertext?: string; iv?: string; version?: number } | undefined;
    const ciphertext = b64ToBuf(body?.ciphertext);
    const iv = b64ToBuf(body?.iv);
    const expectedVersion = Number(body?.version ?? 0);
    if (!ciphertext || !iv || !Number.isFinite(expectedVersion)) {
        res.status(400).json({ error: 'ciphertext, iv (base64), version required' });
        return;
    }
    if (ciphertext.length > 1_000_000) {
        res.status(413).json({ error: 'blob too large' }); return;
    }
    if (iv.length !== 12) {
        res.status(400).json({ error: 'iv must be 12 bytes (AES-GCM nonce)' }); return;
    }

    const result = putVault(owner, ciphertext, iv, expectedVersion);
    if (!result.ok) {
        // Only expose the current version; the client refetches if it wants
        // the ciphertext.
        res.status(409).json({ error: 'version conflict', version: result.conflict.version });
        return;
    }
    res.json({ ok: true, version: result.version });
});

export default router;
