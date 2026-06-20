// Server-backed encrypted vault.
//
// Lazy by design: nothing happens — no signature prompt, no fetch — until
// the caller invokes `unlock()`. This lets the dashboard render and serve
// wallet-only browsing without ever asking the user to sign.
//
// `unlock()` is idempotent and resolves to the decrypted data. Subsequent
// `save(...)` calls reuse the cached key + version.

import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { decryptJson, encryptJson, ensureVaultKey, type EncryptedBlob } from '../lib/vault.ts';

type VaultGetResp = EncryptedBlob & { version: number; updated_at: number };

export type VaultStatus =
    | { kind: 'locked' }                            // wallet may be connected, but vault not unlocked
    | { kind: 'awaiting-signature' }                // signature popup is open
    | { kind: 'loading' }                           // fetching from server
    | { kind: 'ready'; version: number }            // decrypted data available
    | { kind: 'error'; message: string };

export function useVault<T>(emptyValue: T) {
    const { publicKey, signMessage } = useWallet();
    const wallet = publicKey?.toBase58() || null;

    const [data, setData] = useState<T>(emptyValue);
    const [status, setStatus] = useState<VaultStatus>({ kind: 'locked' });
    const keyRef = useRef<CryptoKey | null>(null);
    const versionRef = useRef<number>(0);
    const inflight = useRef<Promise<T> | null>(null);

    const unlock = useCallback(async (): Promise<T> => {
        if (!wallet || !signMessage) throw new Error('connect a wallet first');
        if (status.kind === 'ready' && keyRef.current) return data;
        if (inflight.current) return inflight.current;

        const run = (async () => {
            try {
                setStatus({ kind: 'awaiting-signature' });
                const key = await ensureVaultKey(wallet, (msg) => signMessage(msg));
                keyRef.current = key;

                setStatus({ kind: 'loading' });
                const res = await fetch(`/api/vault/${wallet}`);
                if (res.status === 404) {
                    versionRef.current = 0;
                    setData(emptyValue);
                    setStatus({ kind: 'ready', version: 0 });
                    return emptyValue;
                }
                if (!res.ok) throw new Error(`vault get failed: ${res.status}`);
                const body = (await res.json()) as VaultGetResp;
                const plain = await decryptJson<T>(key, body);
                versionRef.current = body.version;
                setData(plain);
                setStatus({ kind: 'ready', version: body.version });
                return plain;
            } catch (e) {
                setStatus({ kind: 'error', message: (e as Error).message });
                throw e;
            } finally {
                inflight.current = null;
            }
        })();
        inflight.current = run;
        return run;
    }, [wallet, signMessage, status.kind, data, emptyValue]);

    const save = useCallback(
        async (next: T): Promise<void> => {
            if (!wallet) throw new Error('connect a wallet first');
            // First save on a fresh session needs the key — unlock implicitly.
            if (!keyRef.current) await unlock();
            if (!keyRef.current) throw new Error('vault not ready');

            const enc = await encryptJson(keyRef.current, next);
            const res = await fetch(`/api/vault/${wallet}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...enc, version: versionRef.current }),
            });
            if (res.status === 409) {
                throw new Error('vault: another tab updated the data, please reload');
            }
            if (!res.ok) throw new Error(`vault put failed: ${res.status}`);
            const body = (await res.json()) as { ok: true; version: number };
            versionRef.current = body.version;
            setData(next);
            setStatus({ kind: 'ready', version: body.version });
        },
        [wallet, unlock],
    );

    return { data, save, status, wallet, unlock };
}
