import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { Notifications } from '@dialectlabs/react-ui';

const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

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
const modal = { background: '#1b1b1c', borderRadius: '12px', padding: '24px', width: '400px', maxWidth: '95vw', border: '1px solid #00d4aa33' };
const label = { color: '#00d4aa', fontSize: '13px', fontWeight: '500', marginBottom: '6px', display: 'block' };
const select = { width: '100%', padding: '10px 12px', background: '#2a2a2b', border: '1px solid #323335', borderRadius: '8px', color: '#fff', fontSize: '14px' };
const checkbox = { display: 'flex', alignItems: 'center', gap: '8px', color: '#c4c6c8', fontSize: '14px', cursor: 'pointer', marginRight: '16px' };
const btn = { width: '100%', padding: '12px', background: '#00d4aa', color: '#0a0a0f', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '16px' };
const btnSecondary = { ...btn, background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa' };
const bellBtn = { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: '1px solid #00d4aa', color: '#00d4aa', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

const AlertModal = ({ isOpen, onClose, wallet, labels, wallets }) => {
    const [target, setTarget] = useState('');
    const [selectedWallets, setSelectedWallets] = useState([]);
    const [threshold, setThreshold] = useState(5);
    const [incoming, setIncoming] = useState(false);
    const [outgoing, setOutgoing] = useState(false);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [showTelegram, setShowTelegram] = useState(false);
    const [saving, setSaving] = useState(false);
    const [telegramConnected, setTelegramConnected] = useState(true); // Default to true - user already set up

    const isPortfolio = target.startsWith('portfolio:');
    const portfolio = isPortfolio ? labels.find(l => `portfolio:${l.id}` === target) : null;
    const portfolioWallets = portfolio?.wallets || [];

    useEffect(() => { setSelectedWallets([]); setPortfolioChange(false); }, [target]);

    const toggleWallet = (addr) => setSelectedWallets(prev => prev.includes(addr) ? prev.filter(w => w !== addr) : [...prev, addr]);

    const save = async () => {
        if (!target) return;
        setSaving(true);
        try {
            const data = {
                owner_wallet: wallet.publicKey.toString(),
                label_id: isPortfolio && selectedWallets.length === 0 ? parseInt(target.split(':')[1]) : null,
                target_wallet: !isPortfolio ? target : (selectedWallets.length > 0 ? selectedWallets.join(',') : null),
                alert_type: portfolioChange ? 'threshold' : (incoming && outgoing ? 'any_tx' : incoming ? 'incoming' : 'outgoing'),
                threshold_percent: portfolioChange ? threshold : null,
                enabled: true,
            };
            const res = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (res.ok) { onClose(); } else { const err = await res.json(); alert(err.error || 'Failed'); }
        } catch (e) { alert('Failed to save'); }
        setSaving(false);
    };

    if (!isOpen) return null;

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modal} onClick={e => e.stopPropagation()}>
                <DialectSolanaSdk dappAddress={DAPP_ADDRESS} customWalletAdapter={wallet} config={{ environment: 'production' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>+ Create Alert</h3>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer' }}>×</button>
                    </div>

                    {showTelegram ? (
                        <div>
                            <p style={{ color: '#c4c6c8', fontSize: '14px', marginBottom: '16px' }}>Connect Telegram to receive notifications:</p>
                            <div className="dialect-telegram-setup" style={{ minHeight: '300px' }}>
                                <Notifications theme="dark" channels={['telegram']} />
                            </div>
                            <button style={btnSecondary} onClick={() => { localStorage.setItem('dialect_telegram_connected', 'true'); setTelegramConnected(true); setShowTelegram(false); }}>
                                ← Back to Alert Setup
                            </button>
                        </div>
                    ) : (
                        <div>
                            {/* Portfolio/Wallet Selection */}
                            <div style={{ marginBottom: '16px' }}>
                                <label style={label}>Select Portfolio or Wallet</label>
                                <select style={select} value={target} onChange={e => setTarget(e.target.value)}>
                                    <option value="">Choose...</option>
                                    {labels.length > 0 && <optgroup label="📁 Portfolios">{labels.map(l => <option key={l.id} value={`portfolio:${l.id}`}>{l.name} ({l.wallets?.length || 0} wallets)</option>)}</optgroup>}
                                    {wallets.length > 0 && <optgroup label="👛 Wallets">{wallets.map(w => <option key={w.address} value={w.address}>{w.label || `${w.address.slice(0, 4)}...${w.address.slice(-4)}`}</option>)}</optgroup>}
                                </select>
                            </div>

                            {/* Wallet filter for portfolios */}
                            {isPortfolio && portfolioWallets.length > 0 && (
                                <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2b', borderRadius: '8px' }}>
                                    <label style={{ ...label, marginBottom: '8px' }}>Filter to specific wallets (optional)</label>
                                    <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                                        {portfolioWallets.map(w => {
                                            const addr = w.address || w;
                                            const name = w.name || `${addr.slice(0, 4)}...${addr.slice(-4)}`;
                                            return <label key={addr} style={{ ...checkbox, marginBottom: '6px' }}><input type="checkbox" checked={selectedWallets.includes(addr)} onChange={() => toggleWallet(addr)} style={{ accentColor: '#00d4aa' }} />{name}</label>;
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Notification Types */}
                            {target && (
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={label}>Notification Type</label>
                                    <div style={{ display: 'flex', marginTop: '8px' }}>
                                        <label style={checkbox}><input type="checkbox" checked={incoming} onChange={e => setIncoming(e.target.checked)} style={{ accentColor: '#00d4aa' }} />Incoming</label>
                                        <label style={checkbox}><input type="checkbox" checked={outgoing} onChange={e => setOutgoing(e.target.checked)} style={{ accentColor: '#00d4aa' }} />Outgoing</label>
                                    </div>
                                    {isPortfolio && selectedWallets.length === 0 && (
                                        <div style={{ marginTop: '12px' }}>
                                            <label style={checkbox}><input type="checkbox" checked={portfolioChange} onChange={e => setPortfolioChange(e.target.checked)} style={{ accentColor: '#00d4aa' }} /><span style={{ color: '#00d4aa' }}>Portfolio Change</span></label>
                                            {portfolioChange && (
                                                <div style={{ marginTop: '8px' }}>
                                                    <input type="range" min="1" max="25" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#00d4aa' }} />
                                                    <div style={{ color: '#00d4aa', fontSize: '14px', textAlign: 'center' }}>{threshold}%</div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Telegram Status */}
                            <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2b', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#c4c6c8', fontSize: '14px' }}>📱 Telegram</span>
                                    <span style={{ color: '#00d4aa', fontSize: '12px' }}>✓ Connected <button onClick={() => setShowTelegram(true)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Manage</button></span>
                                </div>
                            </div>

                            {/* Create Button */}
                            <button style={{ ...btn, opacity: (!target || (!incoming && !outgoing && !portfolioChange)) ? 0.5 : 1 }} onClick={save} disabled={!target || (!incoming && !outgoing && !portfolioChange) || saving}>
                                {saving ? 'Saving...' : 'Create Alert'}
                            </button>
                        </div>
                    )}
                </DialectSolanaSdk>
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
        <div className="dialect" data-theme="dark">
            <button onClick={() => setOpen(true)} style={bellBtn} onMouseOver={e => { e.target.style.background = '#00d4aa'; e.target.style.color = '#0a0a0f'; }} onMouseOut={e => { e.target.style.background = 'transparent'; e.target.style.color = '#00d4aa'; }} title="Create Alert">🔔</button>
            <AlertModal isOpen={open} onClose={() => setOpen(false)} wallet={wallet} labels={labels} wallets={wallets} />
        </div>
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
