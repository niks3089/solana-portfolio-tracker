// Encrypted vault storage.
//
// The server ONLY ever sees opaque ciphertext + IV. There is no decryption
// code on the server. Anyone auditing this file can verify that nothing in
// the request/response path touches the contents of the blob.
//
// The owner_wallet is stored as plaintext (it's the lookup key and the
// connecting wallet's public address, which is already public info). The
// portfolio names, wallet groupings, snapshot history, etc. live inside the
// encrypted blob.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.VAULT_DB_PATH || '/var/lib/portfolio/vault.db';

let db: Database.Database | null = null;

function getDb(): Database.Database {
    if (db) return db;
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS vaults (
            owner_wallet TEXT PRIMARY KEY,
            ciphertext   BLOB NOT NULL,
            iv           BLOB NOT NULL,
            version      INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL
        );
    `);
    return db;
}

export type VaultRow = {
    ciphertext: Buffer;
    iv: Buffer;
    version: number;
    updated_at: number;
};

export function getVault(owner: string): VaultRow | null {
    const row = getDb()
        .prepare('SELECT ciphertext, iv, version, updated_at FROM vaults WHERE owner_wallet = ?')
        .get(owner) as VaultRow | undefined;
    return row ?? null;
}

// Optimistic concurrency: caller passes the version it last saw. If a newer
// version exists on disk, returns the current row instead so the client can
// merge / retry. This is the only protection against simultaneous tabs
// overwriting each other.
export type PutResult =
    | { ok: true; version: number }
    | { ok: false; conflict: VaultRow };

export function putVault(
    owner: string,
    ciphertext: Buffer,
    iv: Buffer,
    expectedVersion: number,
): PutResult {
    const d = getDb();
    const existing = getVault(owner);
    if (existing && existing.version !== expectedVersion) {
        return { ok: false, conflict: existing };
    }
    const nextVersion = (existing?.version ?? 0) + 1;
    const now = Date.now();
    d.prepare(
        `INSERT INTO vaults (owner_wallet, ciphertext, iv, version, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_wallet) DO UPDATE SET
             ciphertext = excluded.ciphertext,
             iv         = excluded.iv,
             version    = excluded.version,
             updated_at = excluded.updated_at`,
    ).run(owner, ciphertext, iv, nextVersion, now);
    return { ok: true, version: nextVersion };
}
