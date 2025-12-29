import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { Notifications } from '@dialectlabs/react-ui';

// Dialect app address
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Custom wallet adapter singleton
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
    if (cachedWalletAdapter && cachedPublicKey === currentPubKey) {
        return cachedWalletAdapter;
    }
    cachedPublicKey = currentPubKey;
    cachedWalletAdapter = {
        publicKey: provider.publicKey,
        signMessage: async (message) => {
            const result = await provider.signMessage(message);
            return result.signature || result;
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
        const checkWallet = () => {
            const newWallet = getWalletAdapter();
            setWallet(prev => {
                if (newWallet && !prev) return newWallet;
                if (!newWallet && prev) return null;
                return prev;
            });
        };
        checkWallet();
        const interval = setInterval(checkWallet, 1500);
        return () => clearInterval(interval);
    }, []);
    return wallet;
};

// Bell button style
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

// Simple modal that just shows Dialect Notifications directly - like Drift
const NotificationsModal = ({ isOpen, onClose, wallet }) => {
    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: '#1b1b1c',
                    borderRadius: '12px',
                    width: '420px',
                    maxWidth: '95vw',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    border: '1px solid #00d4aa33',
                }}
                onClick={e => e.stopPropagation()}
            >
                <DialectSolanaSdk
                    dappAddress={DAPP_ADDRESS}
                    customWalletAdapter={wallet}
                    config={{ environment: 'production' }}
                >
                    <div className="dialect-notifications-wrapper">
                        <Notifications
                            theme="dark"
                            channels={['telegram']}
                        />
                    </div>
                </DialectSolanaSdk>
            </div>
        </div>
    );
};

const DialectNotificationsInner = () => {
    const wallet = useCustomWalletAdapter();
    const [modalOpen, setModalOpen] = useState(false);

    if (!wallet) return null;

    return (
        <div className="dialect" data-theme="dark">
            <button
                onClick={() => setModalOpen(true)}
                style={bellButtonStyle}
                onMouseOver={(e) => { e.target.style.backgroundColor = '#00d4aa'; e.target.style.color = '#0a0a0f'; }}
                onMouseOut={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#00d4aa'; }}
                title="Notification Settings"
            >
                🔔
            </button>
            <NotificationsModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                wallet={wallet}
            />
        </div>
    );
};

const DialectNotifications = () => <DialectNotificationsInner />;

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

if (typeof window !== 'undefined') {
    window.mountDialectNotifications = mountDialectNotifications;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mountDialectNotifications('dialect-notifications-root');
        });
    } else {
        mountDialectNotifications('dialect-notifications-root');
    }
}

export default DialectNotifications;
