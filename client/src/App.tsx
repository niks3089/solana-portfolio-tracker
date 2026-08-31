import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { UnifiedWalletButton } from '@jup-ag/wallet-adapter';
import { useQuery } from '@tanstack/react-query';

import { Dashboard } from './pages/Dashboard.tsx';
import { Logo } from './components/Logo.tsx';
import { PrivacyProvider } from './components/PrivateContext.tsx';
import { usePrivacyMode } from './hooks/usePrivacyMode.ts';
import { fetchFxRates } from './lib/api.ts';
import { CURRENCY_SYMBOLS, setDisplayCurrency } from './lib/format.ts';

const CURRENCIES = Object.keys(CURRENCY_SYMBOLS);

export function App() {
    const { hidden, toggle } = usePrivacyMode();

    const [currency, setCurrency] = useState(() => {
        const saved = localStorage.getItem('displayCurrency');
        return saved && CURRENCIES.includes(saved) ? saved : 'USD';
    });
    const fx = useQuery({
        queryKey: ['fx'],
        queryFn: fetchFxRates,
        staleTime: 6 * 60 * 60 * 1000,
        enabled: currency !== 'USD',
    });
    const rate = currency === 'USD' ? 1 : fx.data?.rates?.[currency] || 0;
    const effCode = rate > 0 ? currency : 'USD';
    const effRate = rate > 0 ? rate : 1;
    setDisplayCurrency(effCode, effRate);

    return (
        <div className="min-h-full">
            <header className="border-b border-border bg-bg-secondary">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6 lg:py-4">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <Logo />
                            <span className="text-base font-semibold text-text-primary">Solana Portfolio</span>
                        </div>
                        <div className="mt-0.5 hidden text-[11px] font-semibold text-text-secondary md:flex md:items-center md:gap-1.5">
                            <span>Track your crypto wealth</span>
                            <span className="text-accent">•</span>
                            <span>Multiple wallets</span>
                            <span className="text-accent">•</span>
                            <span>Private</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <select
                            value={currency}
                            onChange={(e) => {
                                localStorage.setItem('displayCurrency', e.target.value);
                                setCurrency(e.target.value);
                            }}
                            title="Display currency"
                            className="rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm outline-none hover:border-accent/60"
                        >
                            {CURRENCIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={toggle}
                            title={hidden ? 'Show amounts' : 'Hide amounts'}
                            className="rounded-md border border-border bg-bg-tertiary px-2.5 py-1.5 text-sm hover:border-accent/60"
                        >
                            {hidden ? '🔒' : '🔓'}
                        </button>
                        <UnifiedWalletButton />
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
                <PrivacyProvider hidden={hidden}>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </PrivacyProvider>
            </main>
        </div>
    );
}
