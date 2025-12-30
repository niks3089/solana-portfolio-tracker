import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Use the wallet from main page
const useWallet = () => {
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        const check = () => {
            const provider = window.connectedProvider;
            const walletAddr = window.connectedWallet;

            if (!provider || !walletAddr) {
                if (wallet) setWallet(null);
                return;
            }

            if (wallet?.publicKey?.toString() === walletAddr) return;

            setWallet({
                publicKey: provider.publicKey,
                address: walletAddr,
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
const modal = { background: '#1b1b1c', borderRadius: '12px', width: '400px', maxWidth: '95vw', maxHeight: '80vh', overflow: 'hidden', border: '1px solid #00d4aa33' };
const header = { padding: '16px 20px', borderBottom: '1px solid #2a2a2b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const selectStyle = { width: '100%', padding: '10px 12px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', fontSize: '14px', marginBottom: '12px' };
const checkboxLabel = { display: 'flex', alignItems: 'center', gap: '8px', color: '#c4c6c8', fontSize: '14px', cursor: 'pointer', marginBottom: '8px' };
const btnPrimary = { width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const alertCard = { background: '#2a2a2b', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

// Main Modal
const NotificationModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [target, setTarget] = useState('');
    const [walletTx, setWalletTx] = useState(true);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [threshold, setThreshold] = useState(5);
    const [saving, setSaving] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [toast, setToast] = useState(null);

    const isPortfolio = target.startsWith('portfolio:');

    useEffect(() => {
        if (isOpen && wallet) loadAlerts();
    }, [isOpen, wallet]);

    const loadAlerts = async () => {
        if (!wallet?.address) return;
        try {
            const res = await fetch(`/api/alerts/${wallet.address}`);
            const data = await res.json();
            setAlerts(data.alerts || []);
        } catch (e) { setAlerts([]); }
    };

    const save = async () => {
        if (!target) return;
        setSaving(true);
        try {
            const res = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    owner_wallet: wallet.address,
                    label_id: isPortfolio ? parseInt(target.split(':')[1]) : null,
                    target_wallet: !isPortfolio ? target : null,
                    alert_type: portfolioChange ? 'threshold' : 'any_tx',
                    threshold_percent: portfolioChange ? threshold : null,
                    enabled: true,
                })
            });
            if (res.ok) {
                setToast({ msg: 'Alert created!', type: 'success' });
                loadAlerts();
                setTarget('');
            } else {
                const err = await res.json();
                setToast({ msg: err.error || 'Failed', type: 'error' });
            }
        } catch (e) {
            setToast({ msg: 'Failed to create alert', type: 'error' });
        }
        setSaving(false);
        setTimeout(() => setToast(null), 3000);
    };

    const deleteAlert = async (id) => {
        try {
            await fetch(`/api/alerts/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner_wallet: wallet.address })
            });
            loadAlerts();
            setToast({ msg: 'Alert deleted', type: 'success' });
            setTimeout(() => setToast(null), 2000);
        } catch (e) { }
    };

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={header}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '16px' }}>🔔 Alerts</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ padding: '16px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
                    {/* Existing Alerts */}
                    {alerts.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            {alerts.map(alert => (
                                <div key={alert.id} style={alertCard}>
                                    <div>
                                        <div style={{ color: '#fff', fontSize: '14px' }}>
                                            {alert.label_name || `${alert.target_wallet?.slice(0, 6)}...${alert.target_wallet?.slice(-4)}`}
                                        </div>
                                        <div style={{ color: '#888', fontSize: '12px' }}>
                                            {alert.alert_type === 'threshold' ? `${alert.threshold_percent}% change` : 'Transactions'}
                                        </div>
                                    </div>
                                    <button onClick={() => deleteAlert(alert.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px' }}>×</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* New Alert Form */}
                    <div style={{ borderTop: alerts.length > 0 ? '1px solid #2a2a2b' : 'none', paddingTop: alerts.length > 0 ? '16px' : '0' }}>
                        <div style={{ color: '#00d4aa', fontSize: '13px', marginBottom: '12px', fontWeight: '500' }}>+ New Alert</div>

                        <select style={selectStyle} value={target} onChange={e => setTarget(e.target.value)}>
                            <option value="">Select portfolio or wallet...</option>
                            {labels.length > 0 && (
                                <optgroup label="📁 Portfolios">
                                    {labels.map(l => <option key={l.id} value={`portfolio:${l.id}`}>{l.name}</option>)}
                                </optgroup>
                            )}
                            {wallets.length > 0 && (
                                <optgroup label="👛 Wallets">
                                    {wallets.map(w => <option key={w.address} value={w.address}>{w.label || `${w.address.slice(0, 4)}...${w.address.slice(-4)}`}</option>)}
                                </optgroup>
                            )}
                        </select>

                        {target && (
                            <>
                                <label style={checkboxLabel}>
                                    <input type="checkbox" checked={walletTx} onChange={e => setWalletTx(e.target.checked)} style={{ accentColor: '#00d4aa', width: '16px', height: '16px' }} />
                                    Wallet Transactions
                                </label>

                                {isPortfolio && (
                                    <>
                                        <label style={checkboxLabel}>
                                            <input type="checkbox" checked={portfolioChange} onChange={e => setPortfolioChange(e.target.checked)} style={{ accentColor: '#00d4aa', width: '16px', height: '16px' }} />
                                            <span style={{ color: '#00d4aa' }}>Portfolio Change ({threshold}%)</span>
                                        </label>
                                        {portfolioChange && (
                                            <input type="range" min="1" max="25" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} style={{ width: '100%', marginBottom: '12px', accentColor: '#00d4aa' }} />
                                        )}
                                    </>
                                )}

                                <button onClick={save} disabled={saving || (!walletTx && !portfolioChange)} style={{ ...btnPrimary, opacity: (saving || (!walletTx && !portfolioChange)) ? 0.5 : 1, marginTop: '8px' }}>
                                    {saving ? 'Creating...' : 'Create Alert'}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Info */}
                    <div style={{ marginTop: '20px', padding: '12px', background: '#232324', borderRadius: '8px', fontSize: '12px', color: '#888' }}>
                        💡 Alerts are sent via Telegram. Make sure you've connected Telegram to @DialectBots
                    </div>
                </div>

                {/* Toast */}
                {toast && (
                    <div style={{
                        position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
                        background: toast.type === 'error' ? '#ff6b6b' : '#00d4aa',
                        color: toast.type === 'error' ? '#fff' : '#0a0a0f',
                        padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: '500'
                    }}>
                        {toast.msg}
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
            try {
                const s = localStorage.getItem('portfolio_wallets');
                if (s) setWallets(JSON.parse(s));
            } catch { }
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
                title="Alerts"
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
        setTimeout(() => mountDialectNotifications('dialect-notifications-root'), 100);
    }
}

export default DialectNotifications;
