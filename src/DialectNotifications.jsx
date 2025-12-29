import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { Notifications } from '@dialectlabs/react-ui';

const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Use the wallet selected by the main page (not auto-detection)
const useWallet = () => {
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        const check = () => {
            // Use the provider that the main page connected with
            const provider = window.connectedProvider;
            const walletAddr = window.connectedWallet;

            if (!provider || !walletAddr) {
                if (wallet) setWallet(null);
                return;
            }

            // Only update if wallet changed
            if (wallet?.publicKey?.toString() === walletAddr) return;

            console.log('Wallet changed to:', walletAddr);

            setWallet({
                publicKey: provider.publicKey,
                signMessage: async (msg) => {
                    const r = await provider.signMessage(msg);
                    return r.signature || r;
                },
                signTransaction: async (tx) => provider.signTransaction(tx),
                signAllTransactions: async (txs) =>
                    provider.signAllTransactions?.(txs) || Promise.all(txs.map(tx => provider.signTransaction(tx))),
            });
        };

        check();
        const interval = setInterval(check, 500);
        return () => clearInterval(interval);
    }, [wallet]);

    return wallet;
};

// Styles
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal = { background: '#1b1b1c', borderRadius: '12px', width: '420px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', border: '1px solid #00d4aa33' };
const header = { padding: '20px 24px', borderBottom: '1px solid #2a2a2b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' };

// CSS to hide ledger and style Dialect - inject once
const injectDialectStyles = () => {
    if (document.getElementById('dialect-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'dialect-custom-styles';
    style.textContent = `
        /* Hide "Using ledger?" checkbox specifically */
        .dialect-notifications-modal label[class*="dt-"]:has(input[type="checkbox"]):has(span:not([class*="toggle"])) {
            display: none !important;
        }

        /* Style overrides for dark theme */
        .dialect-notifications-modal {
            --dt-bg-primary: #1b1b1c;
            --dt-bg-secondary: #232324;
            --dt-bg-tertiary: #2a2a2b;
            --dt-text-primary: #ffffff;
            --dt-text-secondary: #c4c6c8;
            --dt-accent-brand: #00d4aa;
            --dt-button-primary: #00d4aa;
        }

        /* Green buttons */
        .dialect-notifications-modal button[class*="dt-bg"] {
            background-color: #00d4aa !important;
            color: #0a0a0f !important;
        }

        /* Green accents */
        .dialect-notifications-modal [class*="accent"],
        .dialect-notifications-modal a {
            color: #00d4aa !important;
        }

        /* Hide version footer */
        .dialect-notifications-modal [class*="caption"]:has(span) {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
};

// Error boundary for Dialect
class DialectErrorBoundary extends React.Component {
    state = { hasError: false, error: null };

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('Dialect Error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '20px', textAlign: 'center', color: '#ff6b6b' }}>
                    <p>Failed to load notifications</p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{ background: '#00d4aa', color: '#0a0a0f', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', marginTop: '10px' }}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Hide "Using ledger?" by finding text
const hideLedgerToggle = (container) => {
    if (!container) return;
    // Find all labels and divs with "ledger" text
    container.querySelectorAll('label, div').forEach(el => {
        if (el.textContent?.toLowerCase().includes('ledger')) {
            el.style.display = 'none';
            // Also hide parent if it only contains this
            if (el.parentElement && el.parentElement.children.length === 1) {
                el.parentElement.style.display = 'none';
            }
        }
    });
};

// Single-view modal
const NotificationModal = ({ isOpen, onClose, wallet }) => {
    const [error, setError] = useState(null);
    const containerRef = React.useRef(null);

    useEffect(() => {
        if (isOpen) {
            injectDialectStyles();
            setError(null);
        }
    }, [isOpen]);

    // Hide ledger toggle whenever DOM changes
    useEffect(() => {
        if (!isOpen || !containerRef.current) return;
        
        const hide = () => hideLedgerToggle(containerRef.current);
        hide();
        
        // Watch for changes
        const observer = new MutationObserver(hide);
        observer.observe(containerRef.current, { childList: true, subtree: true });
        
        // Also run periodically
        const interval = setInterval(hide, 200);
        
        return () => {
            observer.disconnect();
            clearInterval(interval);
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const walletKey = wallet?.publicKey?.toString();

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={header}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>🔔 Notifications</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <div ref={containerRef} className="dialect" data-theme="dark" style={{ minHeight: '300px', maxHeight: '70vh', overflowY: 'auto', background: '#1b1b1c' }}>
                    {error ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#ff6b6b' }}>
                            <p>Error: {error}</p>
                            <button onClick={() => setError(null)} style={{ marginTop: '10px', padding: '8px 16px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Retry</button>
                        </div>
                    ) : (
                        <DialectErrorBoundary>
                            <DialectSolanaSdk
                                key={walletKey}
                                dappAddress={DAPP_ADDRESS}
                                customWalletAdapter={wallet}
                                config={{ environment: 'production' }}
                            >
                                <Notifications
                                    theme="dark"
                                    channels={['telegram']}
                                />
                            </DialectSolanaSdk>
                        </DialectErrorBoundary>
                    )}
                </div>
            </div>
        </div>
    );
};

const DialectNotifications = () => {
    const wallet = useWallet();
    const [open, setOpen] = useState(false);

    console.log('DialectNotifications - wallet:', wallet?.publicKey?.toString());

    if (!wallet) return null;

    return (
        <>
            <button
                onClick={() => { console.log('Bell clicked'); setOpen(true); }}
                style={bellBtn}
                onMouseOver={e => { e.currentTarget.style.background = '#00d4aa'; e.currentTarget.style.color = '#0a0a0f'; }}
                onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#00d4aa'; }}
                title="Notifications"
            >
                🔔
            </button>
            <NotificationModal isOpen={open} onClose={() => setOpen(false)} wallet={wallet} />
        </>
    );
};

export function mountDialectNotifications(id) {
    const el = document.getElementById(id);
    if (el && !el._dialectRoot) {
        console.log('Mounting DialectNotifications to', id);
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
