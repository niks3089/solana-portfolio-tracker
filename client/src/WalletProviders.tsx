import { useMemo, type ReactNode } from 'react';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
// Note: @jup-ag/wallet-adapter ships its CSS inline via Tailwind — no separate import needed.

// Jupiter's Unified Wallet Kit gives us a single wallet picker with:
//  - Phantom, Solflare, Backpack, Coinbase, Jupiter Mobile, OKX, Trust …
//  - Wallet Standard auto-detection
//  - Mobile-first responsive modal + dark theme baked in
// We don't need to pass individual adapters — the kit ships them.
export function WalletProviders({ children }: { children: ReactNode }) {
    const config = useMemo(
        () => ({
            autoConnect: true,
            env: 'mainnet-beta' as const,
            metadata: {
                name: 'Portfolio',
                description: 'Self-hosted multi-wallet Solana portfolio tracker',
                url: typeof window !== 'undefined' ? window.location.origin : '',
                iconUrls: [],
            },
            theme: 'dark' as const,
        }),
        [],
    );

    return (
        <UnifiedWalletProvider wallets={[]} config={config}>
            {children}
        </UnifiedWalletProvider>
    );
}
