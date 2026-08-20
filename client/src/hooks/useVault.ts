// Server-backed encrypted vault.
//
// Lazy by design: nothing happens — no signature prompt, no fetch — until
// the caller invokes `unlock()`. This lets the dashboard render and serve
// wallet-only browsing without ever asking the user to sign.
//
// Wallet-switch safety: we key everything by the wallet at call time via
// `currentWalletRef`. If the user disconnects or switches mid-fetch, the
// pending fetch is aborted AND any late setState is discarded, so we never
// display the previous wallet's plaintext after a switch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import {
    decryptJson,
    encryptJson,
    ensureVaultKey,
    ensureVaultToken,
    type EncryptedBlob,
} from '../lib/vault.ts';

type VaultGetResp = EncryptedBlob & { version: number; updated_at: number };

export type VaultStatus =
    | { kind: 'locked' }
    | { kind: 'awaiting-signature' }
    | { kind: 'loading' }
    | { kind: 'ready'; version: number }
    | { kind: 'error'; message: string };

export function useVault<T>(emptyValue: T) {
    const { publicKey, signMessage } = useWallet();
    const wallet = publicKey?.toBase58() || null;

    const [data, setData] = useState<T>(emptyValue);
    const [status, setStatus] = useState<VaultStatus>({ kind: 'locked' });
    const keyRef = useRef<CryptoKey | null>(null);
    const versionRef = useRef<number>(0);
    const inflight = useRef<Promise<T> | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    // Source of truth for "which wallet is the current one". Every async op
    // captures its wallet at start and compares against this ref before
    // touching state, so a pending fetch from wallet A can't setData after
    // the user has switched to wallet B.
    const currentWalletRef = useRef<string | null>(wallet);

    useEffect(() => {
        currentWalletRef.current = wallet;
        // Abort any in-flight fetch belonging to the previous wallet.
        abortRef.current?.abort();
        abortRef.current = null;
        keyRef.current = null;
        versionRef.current = 0;
        inflight.current = null;
        setData(emptyValue);
        setStatus({ kind: 'locked' });
        // emptyValue is expected to be a stable reference in callers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]);

    const unlock = useCallback(async (): Promise<T> => {
        if (!wallet || !signMessage) throw new Error('connect a wallet first');
        if (status.kind === 'ready' && keyRef.current) return data;
        if (inflight.current) return inflight.current;

        const startWallet = wallet;
        const abort = new AbortController();
        abortRef.current = abort;

        const stillCurrent = () => currentWalletRef.current === startWallet && !abort.signal.aborted;

        const run = (async () => {
            try {
                setStatus({ kind: 'awaiting-signature' });
                const key = await ensureVaultKey(startWallet, (msg) => signMessage(msg));
                if (!stillCurrent()) throw new Error('vault: wallet changed');
                keyRef.current = key;

                setStatus({ kind: 'loading' });
                const res = await fetch(`/api/vault/${startWallet}`, { signal: abort.signal });
                if (!stillCurrent()) throw new Error('vault: wallet changed');
                if (res.status === 404) {
                    versionRef.current = 0;
                    setData(emptyValue);
                    setStatus({ kind: 'ready', version: 0 });
                    return emptyValue;
                }
                if (!res.ok) throw new Error(`vault get failed: ${res.status}`);
                const body = (await res.json()) as VaultGetResp;
                const plain = await decryptJson<T>(key, body);
                if (!stillCurrent()) throw new Error('vault: wallet changed');
                versionRef.current = body.version;
                setData(plain);
                setStatus({ kind: 'ready', version: body.version });
                return plain;
            } catch (e) {
                if (stillCurrent()) {
                    setStatus({ kind: 'error', message: (e as Error).message });
                }
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
            if (!wallet || !signMessage) throw new Error('connect a wallet first');
            if (!keyRef.current) await unlock();
            if (!keyRef.current) throw new Error('vault not ready');

            const startWallet = wallet;
            const token = await ensureVaultToken(startWallet, (msg) => signMessage(msg));
            if (currentWalletRef.current !== startWallet) return;

            const enc = await encryptJson(keyRef.current, next);
            const res = await fetch(`/api/vault/${startWallet}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ ...enc, version: versionRef.current }),
            });
            if (currentWalletRef.current !== startWallet) return;

            if (res.status === 409) {
                throw new Error('vault: another tab updated the data, please reload');
            }
            if (res.status === 401) {
                // Token expired — force re-auth on next save.
                throw new Error('vault: session expired, please retry');
            }
            if (!res.ok) throw new Error(`vault put failed: ${res.status}`);
            const body = (await res.json()) as { ok: true; version: number };
            versionRef.current = body.version;
            setData(next);
            setStatus({ kind: 'ready', version: body.version });
        },
        [wallet, signMessage, unlock],
    );

    return { data, save, status, wallet, unlock };
}
