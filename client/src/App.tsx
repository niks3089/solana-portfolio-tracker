import { Navigate, Route, Routes } from 'react-router-dom';
import { UnifiedWalletButton, useWallet } from '@jup-ag/wallet-adapter';

import { Dashboard } from './pages/Dashboard.tsx';

export function App() {
    const { publicKey, connected } = useWallet();
    const short = publicKey?.toBase58().slice(0, 4) + '…' + publicKey?.toBase58().slice(-4);

    return (
        <div className="min-h-full">
            <header className="border-b border-border bg-bg-secondary">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-6 lg:py-4">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">📊</span>
                        <h1 className="text-base font-semibold text-accent">Portfolio</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        {connected && publicKey && (
                            <span className="hidden text-xs text-text-secondary md:inline">{short}</span>
                        )}
                        <UnifiedWalletButton />
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </div>
    );
}
