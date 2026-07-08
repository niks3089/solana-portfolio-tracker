import { useCallback, useEffect, useRef, useState } from 'react';
import {
    EMPTY_VAULT,
    nextPortfolioId,
    readLegacyPortfolios,
    readLegacySnapshots,
    type Portfolio,
    type PortfolioWallet,
    type VaultPayload,
} from '../lib/portfolios.ts';
import { useVault, type VaultStatus } from './useVault.ts';

// Portfolios + snapshots, backed by the encrypted server vault.
// The vault is LAZY — no signature prompt happens until the caller invokes
// unlock() or a save mutation runs (which auto-unlocks on first call).
// `activeId` lives in localStorage; it's just UI state (which portfolio
// am I looking at right now).
export function usePortfolios() {
    const { data, save, status, wallet, unlock } = useVault<VaultPayload>(EMPTY_VAULT);

    const [activeId, setActiveIdState] = useState<number | null>(null);

    useEffect(() => {
        if (status.kind !== 'ready' || !wallet) {
            setActiveIdState(null);
            return;
        }
        const saved = localStorage.getItem(`activeLabelId:${wallet}`);
        const id = saved ? Number.parseInt(saved, 10) : NaN;
        if (Number.isFinite(id) && data.portfolios.some((p) => p.id === id)) {
            setActiveIdState(id);
        } else {
            setActiveIdState(null);
            localStorage.removeItem(`activeLabelId:${wallet}`);
        }
    }, [status.kind, wallet, data.portfolios]);

    const setActiveId = useCallback((id: number | null) => {
        setActiveIdState(id);
        if (!wallet) return;
        if (id == null) localStorage.removeItem(`activeLabelId:${wallet}`);
        else localStorage.setItem(`activeLabelId:${wallet}`, String(id));
    }, [wallet]);

    const persist = useCallback(
        async (next: VaultPayload) => { await save(next); },
        [save],
    );

    const create = useCallback(
        async (name: string, color: string, wallets: PortfolioWallet[]) => {
            const id = nextPortfolioId(data.portfolios);
            const portfolio: Portfolio = { id, name, color, wallets, created_at: new Date().toISOString() };
            await persist({ ...data, portfolios: [...data.portfolios, portfolio] });
            return portfolio;
        },
        [data, persist],
    );

    const update = useCallback(
        async (id: number, patch: Partial<Pick<Portfolio, 'name' | 'color' | 'wallets'>>) => {
            await persist({
                ...data,
                portfolios: data.portfolios.map((p) => (p.id === id ? { ...p, ...patch } : p)),
            });
        },
        [data, persist],
    );

    const remove = useCallback(
        async (id: number) => {
            const { [String(id)]: _gone, ...remainingSnaps } = data.snapshots;
            await persist({
                ...data,
                portfolios: data.portfolios.filter((p) => p.id !== id),
                snapshots: remainingSnaps,
            });
            if (activeId === id) setActiveId(null);
        },
        [data, persist, activeId, setActiveId],
    );

    const recordSnapshot = useCallback(
        async (labelId: number, netWorth: number) => {
            if (status.kind !== 'ready') return;
            if (!Number.isFinite(netWorth) || netWorth <= 0) return;
            const today = new Date().toISOString().slice(0, 10);
            const prev = data.snapshots[String(labelId)] || {};
            if (prev[today] != null && Math.abs(prev[today] - netWorth) / Math.max(1, netWorth) < 0.0001) return;
            const next = { ...prev, [today]: netWorth };
            const keys = Object.keys(next).sort();
            const trimmed: Record<string, number> = {};
            for (const k of keys.slice(-180)) trimmed[k] = next[k]!;
            await persist({
                ...data,
                snapshots: { ...data.snapshots, [String(labelId)]: trimmed },
            });
        },
        [data, persist, status.kind],
    );

    // One-shot legacy migration: runs after unlock when the vault is
    // brand-new (version 0, empty) AND legacy localStorage portfolios exist.
    // Reset per-wallet so migration re-attempts if the user switches wallets.
    // Only mark migration "done" AFTER persist resolves so a transient
    // network / auth failure doesn't lock us out of migrating on the next
    // render cycle.
    const migrationAttempted = useRef<string | null>(null);
    useEffect(() => {
        if (status.kind !== 'ready' || !wallet) return;
        if (status.version !== 0) return;
        if (data.portfolios.length > 0) return;
        if (migrationAttempted.current === wallet) return;

        const legacy = readLegacyPortfolios(wallet);
        if (legacy.length === 0) { migrationAttempted.current = wallet; return; }
        const snapshots: Record<string, Record<string, number>> = {};
        for (const p of legacy) {
            const snaps = readLegacySnapshots(wallet, p.id);
            if (Object.keys(snaps).length > 0) snapshots[String(p.id)] = snaps;
        }
        void persist({ portfolios: legacy, snapshots })
            .then(() => { migrationAttempted.current = wallet; })
            .catch(() => { /* leave the flag unset so we retry next render */ });
    }, [status, wallet, data.portfolios.length, persist]);

    const active = activeId != null ? data.portfolios.find((p) => p.id === activeId) || null : null;
    const snapshotsFor = (labelId: number): Record<string, number> => data.snapshots[String(labelId)] || {};

    return {
        portfolios: data.portfolios,
        active,
        activeId,
        setActiveId,
        create,
        update,
        remove,
        recordSnapshot,
        snapshotsFor,
        status,
        wallet,
        unlock,
    };
}

export type { VaultStatus };
