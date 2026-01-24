import React, { useMemo, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@dialectlabs/react-ui/index.css';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton } from '@dialectlabs/react-ui';
import { PublicKey } from '@solana/web3.js';

// Our dapp's public key (derived from DIALECT_PRIVATE_KEY)
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Custom wallet adapter that uses the connected wallet from the main page
const useWalletAdapter = () => {
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        const checkWallet = () => {
            const walletAddr = window.connectedWallet;
            const provider = window.connectedProvider;

            if (!walletAddr || !provider) {
                if (wallet) setWallet(null);
                return;
            }

            // Only update if address changed
            if (wallet?.publicKey?.toString() === walletAddr) return;

            // Create wallet adapter compatible with Dialect
            const adapter = {
                publicKey: new PublicKey(walletAddr),
                signMessage: async (message) => {
                    if (provider.signMessage) {
                        return await provider.signMessage(message);
                    }
                    throw new Error('Wallet does not support message signing');
                },
                signTransaction: async (tx) => {
                    if (provider.signTransaction) {
                        return await provider.signTransaction(tx);
                    }
                    throw new Error('Wallet does not support transaction signing');
                },
                signAllTransactions: async (txs) => {
                    if (provider.signAllTransactions) {
                        return await provider.signAllTransactions(txs);
                    }
                    throw new Error('Wallet does not support signing multiple transactions');
                },
            };

            setWallet(adapter);
        };

        checkWallet();
        const interval = setInterval(checkWallet, 500);
        return () => clearInterval(interval);
    }, [wallet]);

    return wallet;
};

// Wrapper component that provides the wallet context to Dialect
const DialectNotifications = () => {
    const wallet = useWalletAdapter();

    // Don't render until wallet is connected
    if (!wallet) return null;

    return (
        <DialectSolanaSdk
            dappAddress={DAPP_ADDRESS}
            wallet={wallet}
            config={{
                environment: 'production',
            }}
        >
            <NotificationsButton
                theme="dark"
                channels={['telegram']}
            />
        </DialectSolanaSdk>
    );
};

export function mountDialectNotifications(id) {
    const el = document.getElementById(id);
    if (el && !el._dialectRoot) {
        const root = createRoot(el);
        el._dialectRoot = root;
        root.render(<DialectNotifications />);
        return root;
    }
    return null;
}

if (typeof window !== 'undefined') {
    window.mountDialectNotifications = mountDialectNotifications;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => mountDialectNotifications('dialect-notifications-root'));
    } else {
        setTimeout(() => mountDialectNotifications('dialect-notifications-root'), 100);
    }
}

export default DialectNotifications;
