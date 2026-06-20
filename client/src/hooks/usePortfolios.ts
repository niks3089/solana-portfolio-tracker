import { useCallback, useEffect, useState } from 'react';
import {
    type Portfolio,
    type PortfolioWallet,
    nextPortfolioId,
    readPortfolios,
    writePortfolios,
} from '../lib/portfolios.ts';

export function usePortfolios(connectedWallet: string | null) {
    const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
    const [activeId, setActiveIdState] = useState<number | null>(null);

    // Load from localStorage when wallet changes.
    useEffect(() => {
        if (!connectedWallet) {
            setPortfolios([]);
            setActiveIdState(null);
            return;
        }
        const loaded = readPortfolios(connectedWallet);
        setPortfolios(loaded);

        const saved = localStorage.getItem('activeLabelId');
        const id = saved ? Number.parseInt(saved, 10) : NaN;
        if (Number.isFinite(id) && loaded.some((p) => p.id === id)) {
            setActiveIdState(id);
        } else {
            setActiveIdState(null);
            localStorage.removeItem('activeLabelId');
        }
    }, [connectedWallet]);

    const persist = useCallback(
        (next: Portfolio[]) => {
            setPortfolios(next);
            if (connectedWallet) writePortfolios(connectedWallet, next);
        },
        [connectedWallet],
    );

    const setActiveId = useCallback((id: number | null) => {
        setActiveIdState(id);
        if (id == null) localStorage.removeItem('activeLabelId');
        else localStorage.setItem('activeLabelId', String(id));
    }, []);

    const create = useCallback(
        (name: string, color: string, wallets: PortfolioWallet[]) => {
            const id = nextPortfolioId(portfolios);
            const next: Portfolio = { id, name, color, wallets, created_at: new Date().toISOString() };
            persist([...portfolios, next]);
            return next;
        },
        [portfolios, persist],
    );

    const update = useCallback(
        (id: number, patch: Partial<Pick<Portfolio, 'name' | 'color' | 'wallets'>>) => {
            persist(portfolios.map((p) => (p.id === id ? { ...p, ...patch } : p)));
        },
        [portfolios, persist],
    );

    const remove = useCallback(
        (id: number) => {
            persist(portfolios.filter((p) => p.id !== id));
            if (activeId === id) setActiveId(null);
        },
        [portfolios, persist, activeId, setActiveId],
    );

    const active = activeId != null ? portfolios.find((p) => p.id === activeId) || null : null;

    return { portfolios, active, activeId, setActiveId, create, update, remove };
}
