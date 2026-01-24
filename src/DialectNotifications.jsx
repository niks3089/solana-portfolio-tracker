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

            setWallet({ address: walletAddr });
        };

        check();
        const interval = setInterval(check, 500);
        return () => clearInterval(interval);
    }, [wallet]);

    return wallet;
};

// Styles matching Drift's clean UI with green accent
const styles = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { background: '#1a1a1c', borderRadius: '12px', width: '420px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', border: '1px solid #333' },
    header: { padding: '16px 20px', borderBottom: '1px solid #2a2a2b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    section: { marginBottom: '24px' },
    sectionTitle: { color: '#00d4aa', fontSize: '12px', fontWeight: '500', marginBottom: '12px', textTransform: 'capitalize' },
    card: { background: '#252528', borderRadius: '8px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    input: { width: '100%', padding: '14px 16px', background: '#252528', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', boxSizing: 'border-box' },
    enableBtn: { background: '#3a3a3d', border: 'none', color: '#00d4aa', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
    checkItem: { background: '#252528', borderRadius: '8px', padding: '16px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
    checkbox: (checked) => ({ width: '24px', height: '24px', borderRadius: '6px', background: checked ? '#00d4aa' : 'transparent', border: checked ? 'none' : '2px solid #444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px' }),
};

const NotificationModal = ({ isOpen, onClose, wallet, labels }) => {
    const [alerts, setAlerts] = useState([]);
    const [toast, setToast] = useState(null);
    const [telegramUsername, setTelegramUsername] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [showCodeInput, setShowCodeInput] = useState(false);
    const [telegramVerified, setTelegramVerified] = useState(false);
    const [notificationTypes, setNotificationTypes] = useState({});
    const [codeError, setCodeError] = useState('');
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        if (isOpen && wallet) {
            loadAlerts();
            // Load saved telegram username and verification status
            const saved = localStorage.getItem('telegram_username');
            const verified = localStorage.getItem('telegram_verified') === 'true';
            if (saved) {
                setTelegramUsername(saved);
                setTelegramVerified(verified);
            }
        }
    }, [isOpen, wallet]);

    useEffect(() => {
        // Build notification types from labels
        const types = {};
        labels.forEach(l => {
            types[l.id] = alerts.some(a => a.label_id === l.id && a.enabled);
        });
        setNotificationTypes(types);
    }, [labels, alerts]);

    const loadAlerts = async () => {
        if (!wallet?.address) return;
        try {
            const res = await fetch(`/api/alerts/${wallet.address}`);
            const data = await res.json();
            setAlerts(data.alerts || []);
        } catch (e) { setAlerts([]); }
    };

    const toggleNotificationType = async (labelId) => {
        const existingAlert = alerts.find(a => a.label_id === labelId);

        if (existingAlert) {
            // Toggle existing alert
            try {
                await fetch(`/api/alerts/${existingAlert.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner_wallet: wallet.address, enabled: !existingAlert.enabled })
                });
                loadAlerts();
            } catch (e) { }
        } else {
            // Create new alert
            try {
                await fetch('/api/alerts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        owner_wallet: wallet.address,
                        label_id: labelId,
                        alert_type: 'any_tx',
                        enabled: true,
                    })
                });
                loadAlerts();
                setToast({ msg: 'Alert enabled!', type: 'success' });
                setTimeout(() => setToast(null), 2000);
            } catch (e) {
                setToast({ msg: 'Failed to create alert', type: 'error' });
                setTimeout(() => setToast(null), 3000);
            }
        }
    };

    // Get Dialect JWT by signing their auth message
    const getDialectToken = async () => {
        try {
            const provider = window.connectedProvider;
            if (!provider) {
                throw new Error('Wallet not connected');
            }

            // Step 1: Get message to sign from Dialect
            const prepareRes = await fetch('/api/alerts/dialect/auth/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: wallet?.address })
            });
            const prepareData = await prepareRes.json();

            if (!prepareData.message) {
                throw new Error('Failed to get auth message');
            }

            // Step 2: Sign the message with wallet
            const encodedMessage = new TextEncoder().encode(prepareData.message);
            const { signature } = await provider.signMessage(encodedMessage, 'utf8');
            const signatureBase58 = btoa(String.fromCharCode(...signature));

            // Step 3: Verify signature and get JWT
            const verifyRes = await fetch('/api/alerts/dialect/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: wallet?.address,
                    signature: Array.from(signature),
                    signedMessage: prepareData.message
                })
            });
            const verifyData = await verifyRes.json();

            if (!verifyData.token) {
                throw new Error('Failed to get JWT token');
            }

            return verifyData.token;
        } catch (e) {
            console.error('Failed to get Dialect token:', e);
            throw e;
        }
    };

    const startVerification = async () => {
        const username = telegramUsername.replace('@', '').trim();
        if (!username) {
            setToast({ msg: 'Enter your Telegram username first', type: 'error' });
            setTimeout(() => setToast(null), 3000);
            return;
        }

        setVerifying(true);
        localStorage.setItem('telegram_username', username);

        try {
            // Send verification code to user's Telegram
            const res = await fetch('/api/alerts/telegram/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: wallet?.address,
                    username: username
                })
            });

            const data = await res.json();

            if (data.success) {
                setShowCodeInput(true);
                setToast({ msg: 'Code sent to your Telegram!', type: 'success' });
                setTimeout(() => setToast(null), 3000);
            } else {
                setToast({ msg: data.error || 'Failed to send code', type: 'error' });
                setTimeout(() => setToast(null), 3000);
            }
        } catch (e) {
            console.error('Failed to send code:', e);
            setToast({ msg: 'Failed to send code. Try again.', type: 'error' });
            setTimeout(() => setToast(null), 3000);
        } finally {
            setVerifying(false);
        }
    };

    const submitVerificationCode = async () => {
        const code = verificationCode.trim();
        if (!code) {
            setCodeError('Enter the verification code');
            return;
        }

        // Validate code format (6 digits)
        if (!/^\d{6}$/.test(code)) {
            setCodeError(`Incorrect verification code ${code}`);
            return;
        }

        setVerifying(true);
        setCodeError('');

        try {
            // Verify by sending test notification with the code
            // Backend will check if code matches what was sent to this wallet
            const res = await fetch('/api/alerts/telegram/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: wallet?.address,
                    code: code,
                    username: telegramUsername
                })
            });
            const data = await res.json();

            if (data.success) {
                localStorage.setItem('telegram_verified', 'true');
                localStorage.setItem('telegram_username', telegramUsername);
                setTelegramVerified(true);
                setShowCodeInput(false);
                setCodeError('');
                setToast({ msg: 'Telegram connected!', type: 'success' });
                setTimeout(() => setToast(null), 3000);
            } else {
                setCodeError(data.error || `Incorrect verification code ${code}`);
            }
        } catch (e) {
            console.error('Verification failed:', e);
            setCodeError(`Incorrect verification code ${code}`);
        } finally {
            setVerifying(false);
        }
    };

    const removeTelegram = () => {
        localStorage.removeItem('telegram_username');
        localStorage.removeItem('telegram_verified');
        setTelegramUsername('');
        setTelegramVerified(false);
        setShowCodeInput(false);
    };

    if (!isOpen) return null;

    const walletShort = wallet?.address ? `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : '';

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                <div style={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: '#888', cursor: 'pointer' }} onClick={onClose}>←</span>
                        <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', fontWeight: '500' }}>Notifications Settings</h3>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer' }}>×</button>
                </div>

                <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
                    {/* In App Section */}
                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>In App</div>
                        <div style={styles.card}>
                            <span style={{ color: '#fff', fontSize: '14px' }}>{walletShort}</span>
                            <button style={styles.enableBtn}>Enable</button>
                        </div>
                    </div>

                    {/* Telegram Section */}
                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>Telegram</div>

                        {telegramVerified ? (
                            /* Verified state - show username with delete option */
                            <>
                                <div style={styles.card}>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>{telegramUsername}</span>
                                    <button onClick={removeTelegram} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}>🗑</button>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#00d4aa' }}></div>
                                    <span style={{ color: '#888', fontSize: '13px' }}>Connected</span>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Username input with Submit button */}
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                    <input
                                        type="text"
                                        style={{ ...styles.input, flex: 1, marginBottom: 0 }}
                                        value={telegramUsername}
                                        onChange={e => setTelegramUsername(e.target.value)}
                                        placeholder="@username"
                                    />
                                    <button onClick={startVerification} style={styles.enableBtn}>Submit</button>
                                </div>

                                {/* Code input - shows after clicking Submit */}
                                {showCodeInput && (
                                    <>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                                type="text"
                                                style={{ ...styles.input, flex: 1, border: codeError ? '1px solid #ff6b6b' : '1px solid #00d4aa' }}
                                                value={verificationCode}
                                                onChange={e => { setVerificationCode(e.target.value); setCodeError(''); }}
                                                placeholder="Enter verification code"
                                                autoFocus
                                            />
                                            <button
                                                onClick={submitVerificationCode}
                                                disabled={verifying}
                                                style={{ ...styles.enableBtn, background: '#00d4aa', color: '#0a0a0f', opacity: verifying ? 0.6 : 1 }}
                                            >
                                                {verifying ? '...' : 'Verify'}
                                            </button>
                                        </div>
                                        {codeError && (
                                            <div style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '8px' }}>
                                                {codeError}
                                            </div>
                                        )}
                                        <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
                                            Message <a href="https://t.me/DialectLabsBot?start=DialectLabsBot" target="_blank" rel="noopener" style={{ color: '#00d4aa' }}>@DialectLabsBot</a> on Telegram to get your verification code.
                                        </div>
                                        <button onClick={() => { setShowCodeInput(false); setCodeError(''); }} style={{ background: 'none', border: 'none', color: '#888', fontSize: '12px', marginTop: '4px', cursor: 'pointer' }}>
                                            ✕ Cancel
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    {/* Notification Type Section */}
                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>Notification Type</div>

                        {labels.length === 0 ? (
                            <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                                Create portfolios to enable notifications
                            </div>
                        ) : (
                            labels.map(label => {
                                const isEnabled = alerts.some(a => a.label_id === label.id && a.enabled);
                                return (
                                    <div
                                        key={label.id}
                                        style={styles.checkItem}
                                        onClick={() => toggleNotificationType(label.id)}
                                    >
                                        <div>
                                            <div style={{ color: '#fff', fontSize: '15px', fontWeight: '500', marginBottom: '4px' }}>
                                                {label.name}
                                            </div>
                                            <div style={{ color: '#666', fontSize: '13px' }}>
                                                Alert on wallet transactions
                                            </div>
                                        </div>
                                        <div style={styles.checkbox(isEnabled)}>
                                            {isEnabled && '✓'}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Toast */}
                {toast && (
                    <div style={{
                        position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
                        background: toast.type === 'error' ? '#ff6b6b' : '#00d4aa',
                        color: toast.type === 'error' ? '#fff' : '#0a0a0f',
                        padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '500'
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

    useEffect(() => {
        const load = () => {
            if (window.userLabels) setLabels(window.userLabels);
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
                style={{
                    width: '36px', height: '36px', borderRadius: '8px',
                    background: '#00d4aa', border: 'none', color: '#0a0a0f',
                    fontSize: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
                title="Notification Settings"
            >
                🔔
            </button>
            <NotificationModal isOpen={open} onClose={() => setOpen(false)} wallet={wallet} labels={labels} />
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
