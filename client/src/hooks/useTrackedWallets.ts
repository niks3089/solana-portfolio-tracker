import { useCallback, useEffect, useState } from 'react';
import { readTrackedWallets, writeTrackedWallets } from '../lib/portfolios.ts';

// Per-browser, no-auth-required browsing list. Lives in localStorage so
// users can paste a wallet and see its portfolio without ever touching the
// encrypted vault.
export function useTrackedWallets() {
    const [wallets, setWallets] = useState<string[]>(() => readTrackedWallets());

    // Keep tabs in sync via the storage event.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'trackedWallets') setWallets(readTrackedWallets());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const add = useCallback((addr: string) => {
        setWallets((prev) => {
            if (prev.includes(addr)) return prev;
            const next = [...prev, addr];
            writeTrackedWallets(next);
            return next;
        });
    }, []);

    const remove = useCallback((addr: string) => {
        setWallets((prev) => {
            const next = prev.filter((a) => a !== addr);
            writeTrackedWallets(next);
            return next;
        });
    }, []);

    return { wallets, add, remove };
}
