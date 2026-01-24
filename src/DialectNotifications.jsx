import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Use the wallet from main page
const useWallet = () => {
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        const check = () => {
            const walletAddr = window.connectedWallet;

            if (!walletAddr) {
                if (wallet) setWallet(null);
                return;
            }

            if (wallet?.address === walletAddr) return;

            setWallet({
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
const modal = { background: '#1b1b1c', borderRadius: '12px', width: '420px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', border: '1px solid #00d4aa33' };
const header = { padding: '16px 20px', borderBottom: '1px solid #2a2a2b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const bellBtn = { width: '36px', height: '36px', borderRadius: '8px', background: '#00d4aa', border: 'none', color: '#0a0a0f', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const inputStyle = { width: '100%', padding: '12px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', fontSize: '14px', boxSizing: 'border-box' };
const selectStyle = { ...inputStyle, marginBottom: '12px' };
const btnPrimary = { width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const alertCard = { background: '#2a2a2b', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const toggleStyle = (enabled) => ({
    width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', position: 'relative',
    background: enabled ? '#00d4aa' : '#444', border: 'none', transition: 'background 0.2s'
});
const toggleDot = (enabled) => ({
    position: 'absolute', top: '2px', left: enabled ? '22px' : '2px',
    width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
});

// Main Modal
const NotificationModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [alerts, setAlerts] = useState([]);
    const [toast, setToast] = useState(null);
    const [showNewForm, setShowNewForm] = useState(false);
    const [target, setTarget] = useState('');
    const [saving, setSaving] = useState(false);

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

    const toggleAlert = async (alert) => {
        try {
            await fetch(`/api/alerts/${alert.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner_wallet: wallet.address, enabled: !alert.enabled })
            });
            loadAlerts();
        } catch (e) { }
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

    const createAlert = async () => {
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
                    alert_type: 'any_tx',
                    enabled: true,
                })
            });
            if (res.ok) {
                setToast({ msg: 'Alert created!', type: 'success' });
                loadAlerts();
                setTarget('');
                setShowNewForm(false);
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

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px' }}>←</span>
                        <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', fontWeight: '500' }}>Notifications Settings</h3>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
                    {/* In App Section */}
                    <div style={{ marginBottom: '24px' }}>
                        <div style={{ color: '#00d4aa', fontSize: '12px', fontWeight: '500', marginBottom: '8px', textTransform: 'uppercase' }}>In App</div>
                        <div style={{ ...alertCard, background: '#232324' }}>
                            <span style={{ color: '#fff', fontSize: '14px' }}>{wallet?.address?.slice(0, 4)}...{wallet?.address?.slice(-4)}</span>
                            <button style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}>🗑</button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                            <button style={toggleStyle(true)}><span style={toggleDot(true)}></span></button>
                            <span style={{ color: '#888', fontSize: '13px' }}>Notifications On</span>
                        </div>
                    </div>

                    {/* Telegram Section */}
                    <div style={{ marginBottom: '24px' }}>
                        <div style={{ color: '#00d4aa', fontSize: '12px', fontWeight: '500', marginBottom: '8px', textTransform: 'uppercase' }}>Telegram</div>
                        <div style={{ padding: '16px', background: '#232324', borderRadius: '8px', marginBottom: '12px' }}>
                            <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px 0' }}>
                                To receive Telegram notifications:
                            </p>
                            <ol style={{ color: '#ccc', fontSize: '13px', margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                                <li>Message <a href="https://t.me/DialectLabsBot" target="_blank" rel="noopener" style={{ color: '#00d4aa' }}>@DialectLabsBot</a> on Telegram</li>
                                <li>Send <code style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>/start</code></li>
                                <li>Follow the bot's instructions to link your wallet</li>
                            </ol>
                        </div>
                    </div>

                    {/* Active Alerts Section */}
                    <div style={{ marginBottom: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div style={{ color: '#00d4aa', fontSize: '12px', fontWeight: '500', textTransform: 'uppercase' }}>Wallet Alerts</div>
                            <button 
                                onClick={() => setShowNewForm(!showNewForm)}
                                style={{ background: 'none', border: '1px solid #00d4aa', color: '#00d4aa', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                            >
                                {showNewForm ? 'Cancel' : '+ Add Alert'}
                            </button>
                        </div>

                        {showNewForm && (
                            <div style={{ background: '#232324', padding: '16px', borderRadius: '8px', marginBottom: '12px' }}>
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
                                <button onClick={createAlert} disabled={saving || !target} style={{ ...btnPrimary, opacity: (saving || !target) ? 0.5 : 1 }}>
                                    {saving ? 'Creating...' : 'Create Alert'}
                                </button>
                            </div>
                        )}

                        {alerts.length === 0 && !showNewForm && (
                            <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                                No alerts configured. Click "+ Add Alert" to monitor wallets.
                            </div>
                        )}

                        {alerts.map(alert => (
                            <div key={alert.id} style={alertCard}>
                                <div>
                                    <div style={{ color: '#fff', fontSize: '14px', marginBottom: '2px' }}>
                                        {alert.label_name || `${alert.target_wallet?.slice(0, 6)}...${alert.target_wallet?.slice(-4)}`}
                                    </div>
                                    <div style={{ color: '#666', fontSize: '12px' }}>
                                        {alert.alert_type === 'threshold' ? `${alert.threshold_percent}% change` : 'All transactions'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <button onClick={() => toggleAlert(alert)} style={toggleStyle(alert.enabled)}>
                                        <span style={toggleDot(alert.enabled)}></span>
                                    </button>
                                    <button onClick={() => deleteAlert(alert.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px' }}>🗑</button>
                                </div>
                            </div>
                        ))}
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
                title="Notification Settings"
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
