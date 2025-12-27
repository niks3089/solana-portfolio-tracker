import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton, Notifications } from '@dialectlabs/react-ui';

// Your Dialect app's wallet address from the dashboard
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Styles for custom alert modal
const modalOverlayStyle = {
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
};

const modalStyle = {
    backgroundColor: '#1b1b1c',
    borderRadius: '12px',
    padding: '24px',
    width: '380px',
    maxWidth: '90vw',
    border: '1px solid #00d4aa33',
    boxShadow: '0 0 30px rgba(0, 212, 170, 0.1)',
};

const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#2a2a2b',
    border: '1px solid #323335',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    marginTop: '6px',
};

const selectStyle = {
    ...inputStyle,
    cursor: 'pointer',
};

const labelStyle = {
    color: '#00d4aa',
    fontSize: '13px',
    fontWeight: '500',
    marginBottom: '4px',
    display: 'block',
};

const checkboxContainerStyle = {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
};

const checkboxLabelStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#c4c6c8',
    fontSize: '14px',
    cursor: 'pointer',
};

const sliderContainerStyle = {
    marginTop: '8px',
};

const sliderStyle = {
    width: '100%',
    accentColor: '#00d4aa',
};

const buttonStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: '#00d4aa',
    color: '#0a0a0f',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '16px',
};

const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: 'transparent',
    border: '1px solid #00d4aa',
    color: '#00d4aa',
};

// Custom wallet adapter - singleton to prevent loops
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

    // Return cached adapter if same wallet
    if (cachedWalletAdapter && cachedPublicKey === currentPubKey) {
        return cachedWalletAdapter;
    }

    // Create new adapter
    cachedPublicKey = currentPubKey;
    cachedWalletAdapter = {
        publicKey: provider.publicKey,
        signMessage: async (message) => {
            console.log('Dialect requesting signature...');
            const result = await provider.signMessage(message);
            // Backpack returns { signature: Uint8Array }, Dialect expects Uint8Array
            const sig = result.signature || result;
            console.log('Signature obtained:', sig?.length, 'bytes');
            return sig;
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
        // Check wallet status periodically
        const checkWallet = () => {
            const newWallet = getWalletAdapter();
            setWallet(prev => {
                // Only update if status actually changed
                if (newWallet && !prev) return newWallet;
                if (!newWallet && prev) return null;
                return prev;
            });
        };

        // Check immediately
        checkWallet();

        // Keep checking - need to detect both connect AND disconnect
        const interval = setInterval(checkWallet, 1500);

        return () => clearInterval(interval);
    }, []);

    return wallet;
};

// Custom green bell button style
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

// Custom Alert Modal Component
const AlertModal = ({ isOpen, onClose, wallet, labels, wallets, onSave }) => {
    const [selectedTarget, setSelectedTarget] = useState('');
    const [selectedWallets, setSelectedWallets] = useState([]);
    const [threshold, setThreshold] = useState(5);
    const [incoming, setIncoming] = useState(false);
    const [outgoing, setOutgoing] = useState(false);
    const [portfolioChange, setPortfolioChange] = useState(false);
    const [showTelegramSetup, setShowTelegramSetup] = useState(false);
    const [saving, setSaving] = useState(false);

    // Parse selected target
    const isPortfolio = selectedTarget.startsWith('portfolio:');
    const selectedPortfolio = isPortfolio ? labels.find(l => `portfolio:${l.id}` === selectedTarget) : null;
    const portfolioWallets = selectedPortfolio?.wallets || [];

    // Reset wallet selection when target changes
    useEffect(() => {
        setSelectedWallets([]);
        setPortfolioChange(false);
    }, [selectedTarget]);

    const handleWalletToggle = (addr) => {
        setSelectedWallets(prev => 
            prev.includes(addr) ? prev.filter(w => w !== addr) : [...prev, addr]
        );
    };

    const handleSave = async () => {
        if (!selectedTarget) return;
        
        setSaving(true);
        try {
            const alertData = {
                owner_wallet: wallet.publicKey.toString(),
                label_id: isPortfolio && selectedWallets.length === 0 ? parseInt(selectedTarget.split(':')[1]) : null,
                target_wallet: !isPortfolio ? selectedTarget : (selectedWallets.length > 0 ? selectedWallets.join(',') : null),
                alert_type: portfolioChange ? 'threshold' : (incoming && outgoing ? 'any_tx' : incoming ? 'incoming' : 'outgoing'),
                threshold_percent: portfolioChange ? threshold : null,
                enabled: true,
            };

            const response = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alertData),
            });

            if (response.ok) {
                onSave?.();
                onClose();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to create alert');
            }
        } catch (err) {
            console.error('Save alert error:', err);
            alert('Failed to save alert');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={modalOverlayStyle} onClick={onClose}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, color: '#00d4aa', fontSize: '18px' }}>
                        + Create Alert
                    </h3>
                    <button 
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer' }}
                    >
                        ×
                    </button>
                </div>

                {showTelegramSetup ? (
                    /* Telegram Setup View - shows Dialect inline */
                    <div>
                        <p style={{ color: '#c4c6c8', fontSize: '14px', marginBottom: '16px' }}>
                            Connect your Telegram to receive notifications:
                        </p>
                        <div className="dialect-telegram-setup" style={{ minHeight: '200px' }}>
                            <DialectSolanaSdk
                                dappAddress={DAPP_ADDRESS}
                                customWalletAdapter={wallet}
                                config={{ environment: 'production' }}
                            >
                                <Notifications
                                    theme="dark"
                                    channels={['telegram']}
                                />
                            </DialectSolanaSdk>
                        </div>
                        <button 
                            style={secondaryButtonStyle} 
                            onClick={() => setShowTelegramSetup(false)}
                        >
                            ← Back to Alert Setup
                        </button>
                    </div>
                ) : (
                    /* Alert Configuration View */
                    <div>
                        {/* Step 1: Select Portfolio or Wallet */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={labelStyle}>Select Portfolio or Wallet</label>
                            <select 
                                style={selectStyle}
                                value={selectedTarget}
                                onChange={e => setSelectedTarget(e.target.value)}
                            >
                                <option value="">Choose...</option>
                                {labels.length > 0 && (
                                    <optgroup label="📁 Portfolios">
                                        {labels.map(l => (
                                            <option key={`p-${l.id}`} value={`portfolio:${l.id}`}>
                                                {l.name} ({l.wallets?.length || 0} wallets)
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {wallets.length > 0 && (
                                    <optgroup label="👛 Wallets">
                                        {wallets.map(w => (
                                            <option key={w.address} value={w.address}>
                                                {w.label || `${w.address.slice(0,4)}...${w.address.slice(-4)}`}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        </div>

                        {/* Step 2: If portfolio selected, optionally select specific wallets */}
                        {isPortfolio && portfolioWallets.length > 0 && (
                            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#2a2a2b', borderRadius: '8px' }}>
                                <label style={{ ...labelStyle, marginBottom: '8px' }}>
                                    Filter to specific wallets (optional)
                                </label>
                                <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                                    {portfolioWallets.map(w => {
                                        const addr = w.address || w;
                                        const name = w.name || `${addr.slice(0,4)}...${addr.slice(-4)}`;
                                        return (
                                            <label key={addr} style={{ ...checkboxLabelStyle, marginBottom: '6px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedWallets.includes(addr)}
                                                    onChange={() => handleWalletToggle(addr)}
                                                    style={{ accentColor: '#00d4aa' }}
                                                />
                                                {name}
                                            </label>
                                        );
                                    })}
                                </div>
                                {selectedWallets.length > 0 && (
                                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
                                        {selectedWallets.length} wallet(s) selected
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 3: Notification Type (only show after target selected) */}
                        {selectedTarget && (
                            <div style={{ marginBottom: '16px' }}>
                                <label style={labelStyle}>Notification Type</label>
                                
                                {/* Wallet Activity */}
                                <div style={checkboxContainerStyle}>
                                    <label style={checkboxLabelStyle}>
                                        <input
                                            type="checkbox"
                                            checked={incoming}
                                            onChange={e => setIncoming(e.target.checked)}
                                            style={{ accentColor: '#00d4aa' }}
                                        />
                                        Incoming
                                    </label>
                                    <label style={checkboxLabelStyle}>
                                        <input
                                            type="checkbox"
                                            checked={outgoing}
                                            onChange={e => setOutgoing(e.target.checked)}
                                            style={{ accentColor: '#00d4aa' }}
                                        />
                                        Outgoing
                                    </label>
                                </div>

                                {/* Portfolio Change - only for full portfolios, not individual wallets */}
                                {isPortfolio && selectedWallets.length === 0 && (
                                    <div style={{ marginTop: '12px' }}>
                                        <label style={checkboxLabelStyle}>
                                            <input
                                                type="checkbox"
                                                checked={portfolioChange}
                                                onChange={e => setPortfolioChange(e.target.checked)}
                                                style={{ accentColor: '#00d4aa' }}
                                            />
                                            <span style={{ color: '#00d4aa' }}>Portfolio Change</span>
                                        </label>
                                        {portfolioChange && (
                                            <div style={sliderContainerStyle}>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="25"
                                                    value={threshold}
                                                    onChange={e => setThreshold(parseInt(e.target.value))}
                                                    style={sliderStyle}
                                                />
                                                <div style={{ color: '#00d4aa', fontSize: '14px', textAlign: 'center' }}>
                                                    {threshold}%
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Telegram Setup Link */}
                        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#2a2a2b', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: '#c4c6c8', fontSize: '14px' }}>📱 Telegram</span>
                                <button
                                    onClick={() => setShowTelegramSetup(true)}
                                    style={{ 
                                        background: 'none', 
                                        border: '1px solid #00d4aa', 
                                        color: '#00d4aa', 
                                        padding: '4px 12px', 
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Setup
                                </button>
                            </div>
                        </div>

                        {/* Save Button */}
                        <button
                            style={{
                                ...buttonStyle,
                                opacity: (!selectedTarget || (!incoming && !outgoing && !portfolioChange)) ? 0.5 : 1,
                                cursor: (!selectedTarget || (!incoming && !outgoing && !portfolioChange)) ? 'not-allowed' : 'pointer',
                            }}
                            onClick={handleSave}
                            disabled={!selectedTarget || (!incoming && !outgoing && !portfolioChange) || saving}
                        >
                            {saving ? 'Saving...' : 'Create Alert'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const DialectNotificationsInner = () => {
    const wallet = useCustomWalletAdapter();
    const [modalOpen, setModalOpen] = useState(false);
    const [labels, setLabels] = useState([]);
    const [wallets, setWallets] = useState([]);

    // Load labels and wallets from window/localStorage
    useEffect(() => {
        const loadData = () => {
            // Get labels from window (set by main app)
            if (window.userLabels) {
                setLabels(window.userLabels);
            }
            // Get wallets from localStorage
            try {
                const stored = localStorage.getItem('portfolio_wallets');
                if (stored) {
                    setWallets(JSON.parse(stored));
                }
            } catch (e) {}
        };

        loadData();
        // Re-check periodically
        const interval = setInterval(loadData, 2000);
        return () => clearInterval(interval);
    }, []);

    if (!wallet) {
        return null; // Don't show if wallet not connected
    }

    return (
        <div className="dialect" data-theme="dark">
            {/* Bell Button */}
            <button
                onClick={() => setModalOpen(true)}
                style={bellButtonStyle}
                onMouseOver={(e) => { e.target.style.backgroundColor = '#00d4aa'; e.target.style.color = '#0a0a0f'; }}
                onMouseOut={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#00d4aa'; }}
                title="Alerts"
            >
                🔔
            </button>

            {/* Custom Alert Modal */}
            <AlertModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                wallet={wallet}
                labels={labels}
                wallets={wallets}
                onSave={() => console.log('Alert saved!')}
            />
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

