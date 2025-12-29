import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { Notifications } from '@dialectlabs/react-ui';
import '@dialectlabs/react-ui/index.css';

const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Inject CSS to hide ledger toggle
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
        /* Aggressive: hide any element containing "ledger" text via attribute */
        [data-testid*="ledger" i],
        [aria-label*="ledger" i] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
};
if (typeof document !== 'undefined') injectHideStyles();

// Wallet adapter singleton
let cachedWalletAdapter = null;
let cachedPublicKey = null;

const getWalletAdapter = () => {
    const providers = [
        window.backpack,
        window.phantom?.solana,
        window.solflare,
    ].filter(Boolean);

    let provider = null;
    for (const p of providers) {
        const isConnected = p.isConnected || (p.publicKey && p.publicKey.toString());
        if (isConnected && p.publicKey) {
            provider = p;
            break;
        }
    }

    if (!provider || !provider.publicKey) {
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
const tabStyle = { flex: 1, padding: '12px', background: 'transparent', border: 'none', color: '#888', fontSize: '14px', cursor: 'pointer', borderBottom: '2px solid transparent' };
const tabActiveStyle = { ...tabStyle, color: '#00d4aa', borderBottomColor: '#00d4aa' };

// Dialect wrapper that hides "Using ledger?" and cleans up UI
const DialectWrapper = () => {
    const wrapperRef = React.useRef(null);

    useEffect(() => {
        const hideUnwanted = () => {
            if (!wrapperRef.current) return;

            // Hide "Using ledger?" by finding labels with that text
            wrapperRef.current.querySelectorAll('label, div, span').forEach(el => {
                const text = el.textContent?.toLowerCase() || '';
                if (text.includes('using ledger') || text === 'using ledger?') {
                    el.style.display = 'none';
                    // Hide parent container too
                    let parent = el.parentElement;
                    while (parent && parent !== wrapperRef.current) {
                        if (parent.children.length <= 2) {
                            parent.style.display = 'none';
                        }
                        parent = parent.parentElement;
                    }
                }
            });

            // Also hide by class patterns
            wrapperRef.current.querySelectorAll('[class*="ledger" i], [class*="Ledger"]').forEach(el => {
                el.style.display = 'none';
            });
        };

        // Initial hide + MutationObserver for async renders
        hideUnwanted();

        const observer = new MutationObserver(() => {
            hideUnwanted();
        });

        if (wrapperRef.current) {
            observer.observe(wrapperRef.current, {
                childList: true,
                subtree: true,
                attributes: true
            });
        }

        // Also run on intervals as backup
        const interval = setInterval(hideUnwanted, 500);

        return () => {
            observer.disconnect();
            clearInterval(interval);
        };
    }, []);

    return (
        <div ref={wrapperRef} className="dialect-wrapper" style={{ padding: '0' }}>
            <Notifications
                theme="dark"
                channels={['telegram']}
                notifications={{ emptyState: <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No notifications yet</div> }}
            />
        </div>
    );
};

// Step indicator
const StepIndicator = ({ currentStep }) => {
    const steps = ['Subscribe', 'Link Telegram', 'Create Alerts'];
    return (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px', background: '#232324' }}>
            {steps.map((step, i) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{
                        width: '24px', height: '24px', borderRadius: '50%',
                        background: currentStep > i ? '#00d4aa' : currentStep === i ? '#00d4aa33' : '#2a2a2b',
                        color: currentStep > i ? '#0a0a0f' : currentStep === i ? '#00d4aa' : '#666',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', fontWeight: '600',
                        border: currentStep === i ? '2px solid #00d4aa' : 'none'
                    }}>
                        {currentStep > i ? '✓' : i + 1}
                    </div>
                    <span style={{ color: currentStep >= i ? '#00d4aa' : '#666', fontSize: '12px' }}>{step}</span>
                    {i < steps.length - 1 && <span style={{ color: '#444', margin: '0 4px' }}>→</span>}
                </div>
            ))}
        </div>
    );
};

// Alert creation form (Step 3)
const AlertForm = ({ wallet, labels, wallets, onSave, onBack }) => {
    const [target, setTarget] = useState('');
    const [walletTx, setWalletTx] = useState(true);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [threshold, setThreshold] = useState(5);
    const [saving, setSaving] = useState(false);
    const [alerts, setAlerts] = useState([]);

    const isPortfolio = target.startsWith('portfolio:');

    useEffect(() => {
        loadAlerts();
    }, [wallet]);

    const loadAlerts = async () => {
        try {
            const res = await fetch(`/api/alerts/${wallet.publicKey.toString()}`);
            const data = await res.json();
            setAlerts(data.alerts || []);
        } catch (e) {
            setAlerts([]);
        }
    };

    const save = async () => {
        if (!target) return;
        setSaving(true);
        try {
            const res = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner_wallet: wallet.publicKey.toString(),
                    label_id: isPortfolio ? parseInt(target.split(':')[1]) : null,
                    target_wallet: !isPortfolio ? target : null,
                    alert_type: portfolioChange ? 'threshold' : 'any_tx',
                    threshold_percent: portfolioChange ? threshold : null,
                    enabled: true,
                })
            });
            if (res.ok) {
                onSave('Alert created!');
                loadAlerts();
                setTarget('');
            } else {
                const err = await res.json();
                onSave(null, err.error);
            }
        } catch (e) {
            onSave(null, 'Failed');
        }
        setSaving(false);
    };

    const deleteAlert = async (id) => {
        try {
            await fetch(`/api/alerts/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner_wallet: wallet.publicKey.toString() })
            });
            loadAlerts();
        } catch (e) { }
    };

    return (
        <div style={{ padding: '20px 24px' }}>
            <h4 style={{ color: '#fff', margin: '0 0 16px 0', fontSize: '16px' }}>Your Alerts</h4>

            {alerts.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    {alerts.map(alert => (
                        <div key={alert.id} style={{ background: '#2a2a2b', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ color: '#fff', fontSize: '14px' }}>
                                    {alert.label_name || `${alert.target_wallet?.slice(0, 6)}...`}
                                </div>
                                <div style={{ color: '#888', fontSize: '12px' }}>
                                    {alert.alert_type === 'threshold' ? `${alert.threshold_percent}% change` : 'All transactions'}
                                </div>
                            </div>
                            <button onClick={() => deleteAlert(alert.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px' }}>×</button>
                        </div>
                    ))}
                </div>
            )}

            <h4 style={{ color: '#00d4aa', margin: '0 0 12px 0', fontSize: '14px' }}>+ Add New Alert</h4>

            <select
                style={{ width: '100%', padding: '10px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', marginBottom: '12px' }}
                value={target}
                onChange={e => setTarget(e.target.value)}
            >
                <option value="">Select portfolio or wallet...</option>
                {labels.length > 0 && <optgroup label="📁 Portfolios">{labels.map(l => <option key={l.id} value={`portfolio:${l.id}`}>{l.name}</option>)}</optgroup>}
                {wallets.length > 0 && <optgroup label="👛 Wallets">{wallets.map(w => <option key={w.address} value={w.address}>{w.label || `${w.address.slice(0, 4)}...${w.address.slice(-4)}`}</option>)}</optgroup>}
            </select>

            {target && (
                <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c4c6c8', marginBottom: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={walletTx} onChange={e => setWalletTx(e.target.checked)} style={{ accentColor: '#00d4aa' }} />
                        Wallet Transactions
                    </label>
                    {isPortfolio && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00d4aa', cursor: 'pointer' }}>
                            <input type="checkbox" checked={portfolioChange} onChange={e => setPortfolioChange(e.target.checked)} style={{ accentColor: '#00d4aa' }} />
                            Portfolio Change ({threshold}%)
                        </label>
                    )}
                    {portfolioChange && (
                        <input type="range" min="1" max="25" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} style={{ width: '100%', marginTop: '8px', accentColor: '#00d4aa' }} />
                    )}
                    <button
                        onClick={save}
                        disabled={saving || (!walletTx && !portfolioChange)}
                        style={{ width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', marginTop: '16px', fontWeight: '600', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
                    >
                        {saving ? 'Creating...' : 'Create Alert'}
                    </button>
                </>
            )}

            <div style={{ marginTop: '20px', padding: '12px', background: '#1a1a1a', borderRadius: '8px', fontSize: '12px', color: '#888' }}>
                💡 Not receiving alerts? Check "Settings" tab to connect Telegram.
            </div>
        </div>
    );
};

// Main Modal with tabs
const NotificationModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [tab, setTab] = useState('settings'); // Default to settings for first-time setup
    const [toast, setToast] = useState(null);

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={header}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>🔔 Notifications</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2b' }}>
                    <button style={tab === 'settings' ? tabActiveStyle : tabStyle} onClick={() => setTab('settings')}>
                        Settings
                    </button>
                    <button style={tab === 'alerts' ? tabActiveStyle : tabStyle} onClick={() => setTab('alerts')}>
                        My Alerts
                    </button>
                </div>

                {/* Content */}
                <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    {tab === 'settings' ? (
                        <DialectSolanaSdk
                            key={wallet?.publicKey?.toString()}
                            dappAddress={DAPP_ADDRESS}
                            customWalletAdapter={wallet}
                            config={{ environment: 'production' }}
                        >
                            <DialectWrapper />
                        </DialectSolanaSdk>
                    ) : (
                        <AlertForm
                            wallet={wallet}
                            labels={labels}
                            wallets={wallets}
                            onSave={(msg, err) => {
                                if (err) setToast({ message: err, type: 'error' });
                                else setToast({ message: msg, type: 'success' });
                            }}
                            onBack={() => setTab('setup')}
                        />
                    )}
                </div>

                {/* Toast */}
                {toast && (
                    <div style={{
                        position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
                        background: toast.type === 'error' ? '#ff6b6b' : '#00d4aa',
                        color: toast.type === 'error' ? '#fff' : '#0a0a0f',
                        padding: '10px 20px', borderRadius: '8px', fontSize: '14px'
                    }} onClick={() => setToast(null)}>
                        {toast.message}
                    </div>
                )}
            </div>
        </div>
    );
};

const DialectNotifications = () => {
    const wallet = useWallet();
    const [open, setOpen] = useState(false);
    const [labels, setLabels] = useState([]);
    const [wallets, setWallets] = useState([]);

    useEffect(() => {
        const load = () => {
            if (window.userLabels) setLabels(window.userLabels);
            try { const s = localStorage.getItem('portfolio_wallets'); if (s) setWallets(JSON.parse(s)); } catch { }
        };
        load();
        const i = setInterval(load, 2000);
        return () => clearInterval(i);
    }, []);

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
            <NotificationModal isOpen={open} onClose={() => setOpen(false)} wallet={wallet} labels={labels} wallets={wallets} />
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
