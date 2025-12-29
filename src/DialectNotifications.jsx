import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton } from '@dialectlabs/react-ui';

const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

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
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const selectStyle = { width: '100%', padding: '10px 12px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', fontSize: '14px', marginBottom: '12px' };
const checkboxLabel = { display: 'flex', alignItems: 'center', gap: '8px', color: '#c4c6c8', fontSize: '14px', cursor: 'pointer', marginBottom: '8px' };
const btnPrimary = { width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' };
const alertCard = { background: '#2a2a2b', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

// Alert Form Component
const AlertForm = ({ wallet, labels, wallets, onSave }) => {
    const [target, setTarget] = useState('');
    const [walletTx, setWalletTx] = useState(true);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [threshold, setThreshold] = useState(5);
    const [saving, setSaving] = useState(false);
    const [alerts, setAlerts] = useState([]);

    const isPortfolio = target.startsWith('portfolio:');

    useEffect(() => { loadAlerts(); }, [wallet]);

    const loadAlerts = async () => {
        if (!wallet?.publicKey) return;
        try {
            const res = await fetch(`/api/alerts/${wallet.publicKey.toString()}`);
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
                    owner_wallet: wallet.publicKey.toString(),
                    label_id: isPortfolio ? parseInt(target.split(':')[1]) : null,
                    target_wallet: !isPortfolio ? target : null,
                    alert_type: portfolioChange ? 'threshold' : 'any_tx',
                    threshold_percent: portfolioChange ? threshold : null,
                    enabled: true,
                })
            });
            if (res.ok) {
                onSave?.('Alert created!');
                loadAlerts();
                setTarget('');
            } else {
                const err = await res.json();
                onSave?.(null, err.error);
            }
        } catch (e) { onSave?.(null, 'Failed'); }
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
        <div style={{ padding: '16px 20px' }}>
            <h4 style={{ color: '#00d4aa', margin: '0 0 16px 0', fontSize: '14px' }}>Your Alerts</h4>

            {alerts.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                    {alerts.map(alert => (
                        <div key={alert.id} style={alertCard}>
                            <div>
                                <div style={{ color: '#fff', fontSize: '13px' }}>
                                    {alert.label_name || `${alert.target_wallet?.slice(0, 6)}...`}
                                </div>
                                <div style={{ color: '#888', fontSize: '11px' }}>
                                    {alert.alert_type === 'threshold' ? `${alert.threshold_percent}% change` : 'Transactions'}
                                </div>
                            </div>
                            <button onClick={() => deleteAlert(alert.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px' }}>×</button>
                        </div>
                    ))}
                </div>
            )}

            <h4 style={{ color: '#888', margin: '0 0 12px 0', fontSize: '12px' }}>+ New Alert</h4>

            <select style={selectStyle} value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">Select portfolio or wallet...</option>
                {labels.length > 0 && <optgroup label="📁 Portfolios">{labels.map(l => <option key={l.id} value={`portfolio:${l.id}`}>{l.name}</option>)}</optgroup>}
                {wallets.length > 0 && <optgroup label="👛 Wallets">{wallets.map(w => <option key={w.address} value={w.address}>{w.label || `${w.address.slice(0, 4)}...${w.address.slice(-4)}`}</option>)}</optgroup>}
            </select>

            {target && (
                <>
                    <label style={checkboxLabel}>
                        <input type="checkbox" checked={walletTx} onChange={e => setWalletTx(e.target.checked)} style={{ accentColor: '#00d4aa' }} />
                        Wallet Transactions
                    </label>
                    {isPortfolio && (
                        <>
                            <label style={checkboxLabel}>
                                <input type="checkbox" checked={portfolioChange} onChange={e => setPortfolioChange(e.target.checked)} style={{ accentColor: '#00d4aa' }} />
                                <span style={{ color: '#00d4aa' }}>Portfolio Change ({threshold}%)</span>
                            </label>
                            {portfolioChange && (
                                <input type="range" min="1" max="25" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} style={{ width: '100%', marginBottom: '12px', accentColor: '#00d4aa' }} />
                            )}
                        </>
                    )}
                    <button onClick={save} disabled={saving || (!walletTx && !portfolioChange)} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                        {saving ? 'Creating...' : 'Create Alert'}
                    </button>
                </>
            )}
        </div>
    );
};

// Telegram Setup Section
const TelegramSetup = ({ wallet }) => {
    const [showSetup, setShowSetup] = useState(false);

    if (!showSetup) {
        return (
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a2b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>Telegram Notifications</div>
                        <div style={{ color: '#888', fontSize: '12px' }}>Receive alerts via Telegram</div>
                    </div>
                    <button onClick={() => setShowSetup(true)} style={{ background: '#00d4aa', color: '#0a0a0f', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                        Setup
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ borderBottom: '1px solid #2a2a2b' }}>
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#00d4aa', fontSize: '14px' }}>Telegram Setup</span>
                <button onClick={() => setShowSetup(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>×</button>
            </div>
            <DialectSolanaSdk
                key={wallet?.publicKey?.toString()}
                dappAddress={DAPP_ADDRESS}
                customWalletAdapter={wallet}
                config={{ environment: 'production' }}
            >
                <div className="dialect-setup" style={{ maxHeight: '300px', overflow: 'auto' }}>
                    <NotificationsButton theme="dark" channels={['telegram']} />
                </div>
            </DialectSolanaSdk>
        </div>
    );
};

// Main Modal
const NotificationModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [toast, setToast] = useState(null);

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <div style={header}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>🔔 Notifications</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <TelegramSetup wallet={wallet} />
                    <AlertForm
                        wallet={wallet}
                        labels={labels}
                        wallets={wallets}
                        onSave={(msg, err) => {
                            if (err) setToast({ msg: err, type: 'error' });
                            else if (msg) setToast({ msg, type: 'success' });
                            setTimeout(() => setToast(null), 3000);
                        }}
                    />
                </div>

                {toast && (
                    <div style={{
                        position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
                        background: toast.type === 'error' ? '#ff6b6b' : '#00d4aa',
                        color: toast.type === 'error' ? '#fff' : '#0a0a0f',
                        padding: '8px 16px', borderRadius: '6px', fontSize: '13px'
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
            <button onClick={() => setOpen(true)} style={bellBtn} title="Notifications">🔔</button>
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
