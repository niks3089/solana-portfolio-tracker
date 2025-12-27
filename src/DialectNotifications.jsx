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
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        // Check wallet status periodically
        const checkWallet = () => {
            const newWallet = getWalletAdapter();
            setWallet(prev => {
                // Only update if status actually changed
                if (newWallet && !prev) return newWallet;
                if (!newWallet && prev) return null;
                return prev;
            });
        };

        // Check immediately
        checkWallet();

        // Keep checking - need to detect both connect AND disconnect
        const interval = setInterval(checkWallet, 1500);

        return () => clearInterval(interval);
    }, []);

    return wallet;
};

// Custom green bell button style
const bellButtonStyle = {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    border: '1px solid #00d4aa',
    color: '#00d4aa',
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
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
                >
                    {({ setOpen, ref }) => (
                        <button
                            ref={ref}
                            onClick={() => setOpen(true)}
                            style={bellButtonStyle}
                            onMouseOver={(e) => { e.target.style.backgroundColor = '#00d4aa'; e.target.style.color = '#0a0a0f'; }}
                            onMouseOut={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#00d4aa'; }}
                            title="Alerts"
                        >
                            🔔
                        </button>
                    )}
                </NotificationsButton>
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

