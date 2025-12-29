import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { Notifications } from '@dialectlabs/react-ui';
import '@dialectlabs/react-ui/index.css';

const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Inject CSS to hide ledger toggle and clean up Dialect UI
const injectHideStyles = () => {
    if (document.getElementById('dialect-hide-styles')) return;
    const style = document.createElement('style');
    style.id = 'dialect-hide-styles';
    style.textContent = `
        /* Hide Using Ledger toggle */
        .dialect-wrapper label:has(input[type="checkbox"]):has(span),
        .dialect-wrapper div:has(> label):has(input[type="checkbox"]):not(:has(button)) {
            display: none !important;
        }
        [data-testid*="ledger" i], [aria-label*="ledger" i] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
};
if (typeof document !== 'undefined') injectHideStyles();

// Wallet adapter
let cachedWalletAdapter = null;
let cachedPublicKey = null;

const getWalletAdapter = () => {
    const providers = [window.backpack, window.phantom?.solana, window.solflare].filter(Boolean);
    let provider = null;
    for (const p of providers) {
        if ((p.isConnected || p.publicKey) && p.publicKey) {
            provider = p;
            break;
        }
    }
    if (!provider?.publicKey) {
        cachedWalletAdapter = null;
        cachedPublicKey = null;
        return null;
    }
    const currentPubKey = provider.publicKey.toString();
    if (cachedWalletAdapter && cachedPublicKey === currentPubKey) return cachedWalletAdapter;
    cachedPublicKey = currentPubKey;
    cachedWalletAdapter = {
        publicKey: provider.publicKey,
        signMessage: async (msg) => { const r = await provider.signMessage(msg); return r.signature || r; },
        signTransaction: async (tx) => provider.signTransaction(tx),
        signAllTransactions: async (txs) => provider.signAllTransactions?.(txs) || Promise.all(txs.map(tx => provider.signTransaction(tx))),
    };
    return cachedWalletAdapter;
};

const useWallet = () => {
    const [wallet, setWallet] = useState(null);
    useEffect(() => {
        const check = () => {
            const w = getWalletAdapter();
            setWallet(prev => (w && !prev) ? w : (!w && prev) ? null : prev);
        };
        check();
        const interval = setInterval(check, 1500);
        return () => clearInterval(interval);
    }, []);
    return wallet;
};

// Styles
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal = { background: '#1b1b1c', borderRadius: '12px', width: '420px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', border: '1px solid #00d4aa33' };
const header = { padding: '20px 24px', borderBottom: '1px solid #2a2a2b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' };

// Dialect wrapper - hides unwanted UI elements
const DialectWrapper = () => {
    const wrapperRef = React.useRef(null);

    useEffect(() => {
        const hideUnwanted = () => {
            if (!wrapperRef.current) return;
            wrapperRef.current.querySelectorAll('label, div, span').forEach(el => {
                const text = el.textContent?.toLowerCase() || '';
                if (text.includes('using ledger') || text === 'using ledger?') {
                    el.style.display = 'none';
                    let parent = el.parentElement;
                    while (parent && parent !== wrapperRef.current) {
                        if (parent.children.length <= 2) parent.style.display = 'none';
                        parent = parent.parentElement;
                    }
                }
            });
            wrapperRef.current.querySelectorAll('[class*="ledger" i]').forEach(el => el.style.display = 'none');
        };

        hideUnwanted();
        const observer = new MutationObserver(hideUnwanted);
        if (wrapperRef.current) observer.observe(wrapperRef.current, { childList: true, subtree: true, attributes: true });
        const interval = setInterval(hideUnwanted, 500);
        return () => { observer.disconnect(); clearInterval(interval); };
    }, []);

    return (
        <div ref={wrapperRef} className="dialect-wrapper" style={{ padding: '0' }}>
            <Notifications theme="dark" channels={['telegram']} />
        </div>
    );
};

// Single-view modal - just Dialect's Notifications, like Drift
const NotificationModal = ({ isOpen, onClose, wallet }) => {
    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={header}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>🔔 Notifications</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <DialectSolanaSdk
                        key={wallet?.publicKey?.toString()}
                        dappAddress={DAPP_ADDRESS}
                        customWalletAdapter={wallet}
                        config={{ environment: 'production' }}
                    >
                        <DialectWrapper />
                    </DialectSolanaSdk>
                </div>
            </div>
        </div>
    );
};

const DialectNotifications = () => {
    const wallet = useWallet();
    const [open, setOpen] = useState(false);

    if (!wallet) return null;

    return (
        <>
            <button
                onClick={() => setOpen(true)}
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
        mountDialectNotifications('dialect-notifications-root');
    }
}

export default DialectNotifications;
