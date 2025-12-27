import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton } from '@dialectlabs/react-ui';

// Your Dialect app's wallet address from the dashboard
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Custom wallet adapter - singleton to prevent loops
let cachedWalletAdapter = null;
let cachedPublicKey = null;

const getWalletAdapter = () => {
    const provider = window.backpack || window.phantom?.solana || window.solflare;
    
    if (!provider?.isConnected || !provider?.publicKey) {
        cachedWalletAdapter = null;
        cachedPublicKey = null;
        return null;
    }

    const currentPubKey = provider.publicKey.toString();
    
    // Return cached adapter if same wallet
    if (cachedWalletAdapter && cachedPublicKey === currentPubKey) {
        return cachedWalletAdapter;
    }

    // Create new adapter
    cachedPublicKey = currentPubKey;
    cachedWalletAdapter = {
        publicKey: provider.publicKey,
        signMessage: async (message) => {
            console.log('Dialect requesting signature...');
            const result = await provider.signMessage(message);
            // Backpack returns { signature: Uint8Array }, Dialect expects Uint8Array
            const sig = result.signature || result;
            console.log('Signature obtained:', sig?.length, 'bytes');
            return sig;
        },
        signTransaction: async (tx) => provider.signTransaction(tx),
        signAllTransactions: async (txs) =>
            provider.signAllTransactions?.(txs) || Promise.all(txs.map(tx => provider.signTransaction(tx))),
    };

    return cachedWalletAdapter;
};

const useCustomWalletAdapter = () => {
    const [wallet, setWallet] = useState(() => getWalletAdapter());

    useEffect(() => {
        // Check once on mount
        setWallet(getWalletAdapter());

        // Only check periodically if not connected yet
        const interval = setInterval(() => {
            const newWallet = getWalletAdapter();
            if (newWallet && !wallet) {
                setWallet(newWallet);
                clearInterval(interval); // Stop checking once connected
            } else if (!newWallet && wallet) {
                setWallet(null);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    return wallet;
};

const DialectNotificationsInner = () => {
    const wallet = useCustomWalletAdapter();

    if (!wallet) {
        return null; // Don't show if wallet not connected
    }

    return (
        <div className="dialect" data-theme="dark">
            <DialectSolanaSdk
                dappAddress={DAPP_ADDRESS}
                customWalletAdapter={wallet}
                config={{
                    environment: 'production',
                }}
            >
                <NotificationsButton
                    theme="dark"
                    channels={['telegram']}
                    dialectId="dialect-notifications"
                    notifications={[
                        { name: 'Wallet Activity', detail: 'Get notified on wallet transactions' },
                        { name: 'Portfolio Change', detail: 'Alert when portfolio value changes significantly' },
                    ]}
                />
            </DialectSolanaSdk>
        </div>
    );
};

// Main component that mounts when called
const DialectNotifications = () => {
    return <DialectNotificationsInner />;
};

// Mount function for use from vanilla JS
export function mountDialectNotifications(containerId) {
    const container = document.getElementById(containerId);
    if (container && !container._dialectRoot) {
        const root = createRoot(container);
        container._dialectRoot = root;
        root.render(<DialectNotifications />);
        return root;
    }
    return null;
}

// Auto-mount if container exists
if (typeof window !== 'undefined') {
    window.mountDialectNotifications = mountDialectNotifications;

    // Auto-mount when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mountDialectNotifications('dialect-notifications-root');
        });
    } else {
        mountDialectNotifications('dialect-notifications-root');
    }
}

export default DialectNotifications;

