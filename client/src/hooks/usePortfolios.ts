import { useCallback, useEffect, useState } from 'react';
import {
    EMPTY_VAULT,
    nextPortfolioId,
    type Portfolio,
    type PortfolioWallet,
    type VaultPayload,
} from '../lib/portfolios.ts';
import { useVault, type VaultStatus } from './useVault.ts';

// Portfolio CRUD + active selection, backed by the encrypted server vault.
// `activeId` lives in localStorage (it's just UI state, not user data —
// "which portfolio am I looking at right now").
export function usePortfolios() {
    const { data, save, status, wallet } = useVault<VaultPayload>(EMPTY_VAULT);

    const [activeId, setActiveIdState] = useState<number | null>(null);

    // Restore activeId after the vault loads.
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
        async (next: VaultPayload) => {
            await save(next);
        },
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

    const addTracked = useCallback(
        async (addr: string) => {
            if (data.trackedWallets.includes(addr)) return;
            await persist({ ...data, trackedWallets: [...data.trackedWallets, addr] });
        },
        [data, persist],
    );

    const removeTracked = useCallback(
        async (addr: string) => {
            await persist({ ...data, trackedWallets: data.trackedWallets.filter((a) => a !== addr) });
        },
        [data, persist],
    );

    const recordSnapshot = useCallback(
        async (labelId: number, netWorth: number) => {
            if (!Number.isFinite(netWorth) || netWorth <= 0) return;
            const today = new Date().toISOString().slice(0, 10);
            const prev = data.snapshots[String(labelId)] || {};
            // Skip if today's value already matches within 0.01% — avoids vault churn on every render.
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
        [data, persist],
    );

    const active = activeId != null ? data.portfolios.find((p) => p.id === activeId) || null : null;
    const snapshotsFor = (labelId: number): Record<string, number> => data.snapshots[String(labelId)] || {};

    return {
        portfolios: data.portfolios,
        trackedWallets: data.trackedWallets,
        active,
        activeId,
        setActiveId,
        create,
        update,
        remove,
        addTracked,
        removeTracked,
        recordSnapshot,
        snapshotsFor,
        status,
    };
}

export type { VaultStatus };
