import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Wallet adapter singleton
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
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal = { background: '#1b1b1c', borderRadius: '12px', padding: '24px', width: '420px', maxWidth: '95vw', maxHeight: '80vh', overflowY: 'auto', border: '1px solid #00d4aa33' };
const labelStyle = { color: '#00d4aa', fontSize: '13px', fontWeight: '500', marginBottom: '6px', display: 'block' };
const selectStyle = { width: '100%', padding: '10px 12px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', fontSize: '14px' };
const checkboxStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: '#c4c6c8', fontSize: '14px', cursor: 'pointer' };
const btnStyle = { width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const btnSecondary = { ...btnStyle, background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa' };
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const alertCard = { background: '#2a2a2b', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

// Create Alert Form
const CreateAlertForm = ({ wallet, labels, wallets, onSave, onCancel }) => {
    const [target, setTarget] = useState('');
    const [selectedWallets, setSelectedWallets] = useState([]);
    const [threshold, setThreshold] = useState(5);
    const [walletTx, setWalletTx] = useState(true);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [saving, setSaving] = useState(false);

    const isPortfolio = target.startsWith('portfolio:');
    const portfolio = isPortfolio ? labels.find(l => `portfolio:${l.id}` === target) : null;
    const portfolioWallets = portfolio?.wallets || [];

    // Auto-select all wallets when portfolio changes
    useEffect(() => {
        if (isPortfolio && portfolioWallets.length > 0) {
            setSelectedWallets(portfolioWallets.map(w => w.address || w));
        } else {
            setSelectedWallets([]);
        }
        setPortfolioChange(false);
    }, [target]);

    const toggleWallet = (addr) => setSelectedWallets(prev => prev.includes(addr) ? prev.filter(w => w !== addr) : [...prev, addr]);

    const save = async () => {
        if (!target) return;
        setSaving(true);
        try {
            const data = {
                owner_wallet: wallet.publicKey.toString(),
                label_id: isPortfolio ? parseInt(target.split(':')[1]) : null,
                target_wallet: !isPortfolio ? target : (selectedWallets.length > 0 ? selectedWallets.join(',') : null),
                alert_type: portfolioChange ? 'threshold' : 'any_tx',
                threshold_percent: portfolioChange ? threshold : null,
                enabled: true,
            };
            const res = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (res.ok) {
                onSave();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed');
            }
        } catch (e) { alert('Failed to save'); }
        setSaving(false);
    };

    const canCreate = target && (walletTx || portfolioChange);

    return (
        <div>
            {/* Portfolio/Wallet Selection */}
            <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Select Portfolio or Wallet</label>
                <select style={selectStyle} value={target} onChange={e => setTarget(e.target.value)}>
                    <option value="">Choose...</option>
                    {labels.length > 0 && <optgroup label="📁 Portfolios">{labels.map(l => <option key={l.id} value={`portfolio:${l.id}`}>{l.name} ({l.wallets?.length || 0} wallets)</option>)}</optgroup>}
                    {wallets.length > 0 && <optgroup label="👛 Wallets">{wallets.map(w => <option key={w.address} value={w.address}>{w.label || `${w.address.slice(0, 4)}...${w.address.slice(-4)}`}</option>)}</optgroup>}
                </select>
            </div>

            {/* Wallet filter for portfolios */}
            {isPortfolio && portfolioWallets.length > 0 && (
                <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2b', borderRadius: '8px' }}>
                    <label style={{ ...labelStyle, marginBottom: '8px' }}>Wallets to monitor</label>
                    <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                        {portfolioWallets.map(w => {
                            const addr = w.address || w;
                            const name = w.name || `${addr.slice(0, 4)}...${addr.slice(-4)}`;
                            return (
                                <label key={addr} style={{ ...checkboxStyle, marginBottom: '6px' }}>
                                    <input type="checkbox" checked={selectedWallets.includes(addr)} onChange={() => toggleWallet(addr)} style={{ accentColor: '#00d4aa', width: '16px', height: '16px' }} />
                                    {name}
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Notification Types */}
            {target && (
                <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>Notification Type</label>
                    <div style={{ marginTop: '8px' }}>
                        <label style={{ ...checkboxStyle, marginBottom: '12px' }}>
                            <input type="checkbox" checked={walletTx} onChange={e => setWalletTx(e.target.checked)} style={{ accentColor: '#00d4aa', width: '16px', height: '16px' }} />
                            <span>Wallet Transactions</span>
                        </label>
                        {isPortfolio && (
                            <div>
                                <label style={checkboxStyle}>
                                    <input type="checkbox" checked={portfolioChange} onChange={e => setPortfolioChange(e.target.checked)} style={{ accentColor: '#00d4aa', width: '16px', height: '16px' }} />
                                    <span style={{ color: '#00d4aa' }}>Portfolio Change</span>
                                </label>
                                {portfolioChange && (
                                    <div style={{ marginTop: '8px', marginLeft: '24px' }}>
                                        <input type="range" min="1" max="25" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#00d4aa' }} />
                                        <div style={{ color: '#00d4aa', fontSize: '14px', textAlign: 'center' }}>{threshold}%</div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Telegram Status */}
            <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2b', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#c4c6c8', fontSize: '14px' }}>📱 Telegram</span>
                    <span style={{ color: '#00d4aa', fontSize: '12px' }}>✓ Connected</span>
                </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
                {onCancel && (
                    <button style={btnSecondary} onClick={onCancel}>Cancel</button>
                )}
                <button
                    style={{ ...btnStyle, flex: 1, opacity: canCreate ? 1 : 0.5, cursor: canCreate ? 'pointer' : 'not-allowed' }}
                    onClick={save}
                    disabled={!canCreate || saving}
                >
                    {saving ? 'Saving...' : 'Create Alert'}
                </button>
            </div>
        </div>
    );
};

// Alert List View
const AlertsList = ({ alerts, onDelete, onAddNew }) => {
    const [deleting, setDeleting] = useState(null);

    const handleDelete = async (id) => {
        setDeleting(id);
        try {
            const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                onDelete(id);
            }
        } catch (e) {
            console.error('Delete failed:', e);
        }
        setDeleting(null);
    };

    return (
        <div>
            <div style={{ marginBottom: '16px' }}>
                {alerts.length === 0 ? (
                    <p style={{ color: '#888', textAlign: 'center', padding: '20px 0' }}>No alerts yet</p>
                ) : (
                    alerts.map(alert => (
                        <div key={alert.id} style={alertCard}>
                            <div>
                                <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
                                    {alert.label_name || (alert.target_wallet ? `${alert.target_wallet.slice(0, 6)}...` : 'Unknown')}
                                </div>
                                <div style={{ color: '#888', fontSize: '12px', marginTop: '2px' }}>
                                    {alert.alert_type === 'threshold' ? `${alert.threshold_percent}% change` : 'Transactions'}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(alert.id)}
                                disabled={deleting === alert.id}
                                style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: '4px 8px' }}
                            >
                                {deleting === alert.id ? '...' : '×'}
                            </button>
                        </div>
                    ))
                )}
            </div>
            <button style={btnStyle} onClick={onAddNew}>+ New Alert</button>
        </div>
    );
};

// Main Modal
const AlertModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [view, setView] = useState('list'); // 'list' or 'create'
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    // Load alerts
    useEffect(() => {
        if (isOpen && wallet) {
            loadAlerts();
        }
    }, [isOpen, wallet]);

    const loadAlerts = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/alerts/${wallet.publicKey.toString()}`);
            const data = await res.json();
            setAlerts(data.alerts || []);
        } catch (e) {
            console.error('Failed to load alerts:', e);
            setAlerts([]);
        }
        setLoading(false);
    };

    const handleSave = () => {
        loadAlerts();
        setView('list');
    };

    const handleDelete = (id) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
    };

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>
                        {view === 'list' ? '🔔 Alerts' : '+ Create Alert'}
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer' }}>×</button>
                </div>

                {loading ? (
                    <p style={{ color: '#888', textAlign: 'center', padding: '20px 0' }}>Loading...</p>
                ) : view === 'list' ? (
                    <AlertsList
                        alerts={alerts}
                        onDelete={handleDelete}
                        onAddNew={() => setView('create')}
                    />
                ) : (
                    <CreateAlertForm
                        wallet={wallet}
                        labels={labels}
                        wallets={wallets}
                        onSave={handleSave}
                        onCancel={alerts.length > 0 ? () => setView('list') : null}
                    />
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
            <button onClick={() => setOpen(true)} style={bellBtn} onMouseOver={e => { e.target.style.background = '#00d4aa'; e.target.style.color = '#0a0a0f'; }} onMouseOut={e => { e.target.style.background = 'transparent'; e.target.style.color = '#00d4aa'; }} title="Alerts">🔔</button>
            <AlertModal isOpen={open} onClose={() => setOpen(false)} wallet={wallet} labels={labels} wallets={wallets} />
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
