import React from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton } from '@dialectlabs/react-ui';

// Your Dialect app's wallet address from the dashboard
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Custom wallet adapter that uses the already-connected wallet
const useCustomWalletAdapter = () => {
    const [wallet, setWallet] = React.useState(null);

    React.useEffect(() => {
        // Check for connected wallet from parent window
        const checkWallet = () => {
            const provider = window.backpack || window.phantom?.solana || window.solflare;
            if (provider?.isConnected && provider?.publicKey) {
                setWallet({
                    publicKey: provider.publicKey,
                    signMessage: async (message) => {
                        const result = await provider.signMessage(message);
                        return result.signature || result;
                    },
                    signTransaction: async (tx) => provider.signTransaction(tx),
                    signAllTransactions: async (txs) => provider.signAllTransactions?.(txs) || Promise.all(txs.map(tx => provider.signTransaction(tx))),
                });
            } else {
                setWallet(null);
            }
        };

        checkWallet();
        // Re-check when wallet connects
        const interval = setInterval(checkWallet, 1000);
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

