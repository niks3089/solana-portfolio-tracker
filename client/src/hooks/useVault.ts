// Server-backed encrypted vault. Pulls + decrypts the ciphertext on mount,
// and exposes a `save` that encrypts + PUTs back with optimistic version
// concurrency. Returns null until the user signs the challenge so we have a
// decryption key.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { decryptJson, encryptJson, ensureVaultKey, type EncryptedBlob } from '../lib/vault.ts';

type VaultGetResp = EncryptedBlob & { version: number; updated_at: number };

export type VaultStatus =
    | { kind: 'idle' }                              // no wallet connected
    | { kind: 'awaiting-signature' }                // needs the user to sign
    | { kind: 'loading' }                           // fetching from server
    | { kind: 'ready'; version: number }            // decrypted data available
    | { kind: 'error'; message: string };

export function useVault<T>(emptyValue: T) {
    const { publicKey, signMessage } = useWallet();
    const wallet = publicKey?.toBase58() || null;

    const [data, setData] = useState<T>(emptyValue);
    const [status, setStatus] = useState<VaultStatus>({ kind: 'idle' });
    const keyRef = useRef<CryptoKey | null>(null);
    const versionRef = useRef<number>(0);

    // Load + decrypt on wallet change.
    useEffect(() => {
        let cancelled = false;
        if (!wallet || !signMessage) {
            keyRef.current = null;
            versionRef.current = 0;
            setData(emptyValue);
            setStatus({ kind: 'idle' });
            return;
        }
        (async () => {
            try {
                setStatus({ kind: 'awaiting-signature' });
                const key = await ensureVaultKey(wallet, (msg) => signMessage(msg));
                if (cancelled) return;
                keyRef.current = key;

                setStatus({ kind: 'loading' });
                const res = await fetch(`/api/vault/${wallet}`);
                if (res.status === 404) {
                    versionRef.current = 0;
                    setData(emptyValue);
                    setStatus({ kind: 'ready', version: 0 });
                    return;
                }
                if (!res.ok) throw new Error(`vault get failed: ${res.status}`);
                const body = (await res.json()) as VaultGetResp;
                const plain = await decryptJson<T>(key, body);
                if (cancelled) return;
                versionRef.current = body.version;
                setData(plain);
                setStatus({ kind: 'ready', version: body.version });
            } catch (e) {
                if (cancelled) return;
                setStatus({ kind: 'error', message: (e as Error).message });
            }
        })();
        return () => { cancelled = true; };
        // emptyValue must be stable in callers (defined outside render).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet, signMessage]);

    const save = useCallback(
        async (next: T): Promise<void> => {
            if (!wallet || !keyRef.current) throw new Error('vault not ready');
            const enc = await encryptJson(keyRef.current, next);
            const res = await fetch(`/api/vault/${wallet}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...enc, version: versionRef.current }),
            });
            if (res.status === 409) {
                // Refetch + merge — for now, throw so the caller can decide.
                throw new Error('vault: another tab updated the data, please reload');
            }
            if (!res.ok) throw new Error(`vault put failed: ${res.status}`);
            const body = (await res.json()) as { ok: true; version: number };
            versionRef.current = body.version;
            setData(next);
            setStatus({ kind: 'ready', version: body.version });
        },
        [wallet],
    );

    return { data, save, status, wallet };
}
