import { Navigate, Route, Routes } from 'react-router-dom';
import { UnifiedWalletButton } from '@jup-ag/wallet-adapter';

import { Dashboard } from './pages/Dashboard.tsx';
import { Logo } from './components/Logo.tsx';
import { PrivacyProvider } from './components/PrivateContext.tsx';
import { usePrivacyMode } from './hooks/usePrivacyMode.ts';

export function App() {
    const { hidden, toggle } = usePrivacyMode();

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
