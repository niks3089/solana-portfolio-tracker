/**
 * Helius WebSocket Manager - Real-time wallet monitoring for alerts
 */

import WebSocket from 'ws';
import { HELIUS_WS_URL, CONFIG } from '../config.js';
const HELIUS_API_KEY = CONFIG.HELIUS_API_KEY;
import { pool } from '../db.js';
import { sendWalletActivityNotification } from './dialect-sdk.js';

// Fetch recent transaction details from Helius
async function getRecentTransaction(wallet) {
    try {
        const response = await fetch(
            `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=1`
        );
        if (!response.ok) return null;
        const txs = await response.json();
        return txs[0] || null;
    } catch (e) {
        console.error('Failed to fetch transaction:', e.message);
        return null;
    }
}

// Format SOL amount
function formatSol(lamports) {
    const sol = lamports / 1e9;
    if (sol >= 1000) return `${(sol / 1000).toFixed(2)}K SOL`;
    if (sol >= 1) return `${sol.toFixed(4)} SOL`;
    return `${(sol * 1000).toFixed(2)} mSOL`;
}

// Format token amount
function formatAmount(amount, decimals = 9, symbol = '') {
    const val = amount / Math.pow(10, decimals);
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M ${symbol}`.trim();
    if (val >= 1000) return `${(val / 1000).toFixed(2)}K ${symbol}`.trim();
    if (val >= 1) return `${val.toFixed(2)} ${symbol}`.trim();
    return `${val.toFixed(6)} ${symbol}`.trim();
}

class HeliusWebSocketManager {
    constructor() {
        this.ws = null;
        this.subscriptions = new Map(); // wallet -> subscriptionId
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.isConnected = false;
        this.pendingSubscriptions = [];
        this.messageId = 1;
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        console.log('🔌 Connecting to Helius WebSocket...');
        this.ws = new WebSocket(HELIUS_WS_URL);

        this.ws.on('open', () => {
            console.log('✓ Helius WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.resubscribeAll();
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleMessage(message);
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        });

        this.ws.on('close', () => {
            console.log('⚠ Helius WebSocket disconnected');
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
        });
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        setTimeout(() => this.connect(), delay);
    }

    handleMessage(message) {
        // Subscription confirmation
        if (message.result !== undefined && message.id) {
            const pending = this.pendingSubscriptions.find(p => p.id === message.id);
            if (pending) {
                this.subscriptions.set(pending.wallet, message.result);
                console.log(`✓ Subscribed to wallet: ${pending.wallet.slice(0, 8)}...`);
                this.pendingSubscriptions = this.pendingSubscriptions.filter(p => p.id !== message.id);
            }
            return;
        }

        // Account notification (transaction detected)
        if (message.method === 'accountNotification') {
            const subscriptionId = message.params?.subscription;
            const wallet = [...this.subscriptions.entries()].find(([_, id]) => id === subscriptionId)?.[0];

            if (wallet) {
                console.log(`📬 Transaction detected on wallet: ${wallet.slice(0, 8)}...`);
                this.onWalletActivity(wallet, message.params?.result);
            }
        }
    }

    async subscribeToWallet(wallet) {
        if (!this.isConnected) {
            console.log('WebSocket not connected, queuing subscription...');
            return;
        }

        if (this.subscriptions.has(wallet)) {
            return; // Already subscribed
        }

        const id = this.messageId++;
        this.pendingSubscriptions.push({ id, wallet });

        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'accountSubscribe',
            params: [wallet, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        }));
    }

    async unsubscribeFromWallet(wallet) {
        const subscriptionId = this.subscriptions.get(wallet);
        if (!subscriptionId || !this.isConnected) return;

        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: this.messageId++,
            method: 'accountUnsubscribe',
            params: [subscriptionId],
        }));

        this.subscriptions.delete(wallet);
        console.log(`✓ Unsubscribed from wallet: ${wallet.slice(0, 8)}...`);
    }

    async resubscribeAll() {
        try {
            // Get individual wallet alerts
            const walletAlerts = await pool.query(`
                SELECT DISTINCT target_wallet
                FROM alert_settings
                WHERE enabled = true AND target_wallet IS NOT NULL
            `);

            // Get label/portfolio alerts - extract wallet addresses from JSONB array
            const labelAlerts = await pool.query(`
                SELECT DISTINCT elem->>'address' as wallet_address
                FROM alert_settings a
                JOIN labels l ON a.label_id = l.id,
                jsonb_array_elements(l.wallets) as elem
                WHERE a.enabled = true AND a.label_id IS NOT NULL
            `);

            const walletsToSubscribe = new Set();

            for (const row of walletAlerts.rows) {
                if (row.target_wallet) walletsToSubscribe.add(row.target_wallet);
            }

            for (const row of labelAlerts.rows) {
                if (row.wallet_address) walletsToSubscribe.add(row.wallet_address);
            }

            for (const wallet of walletsToSubscribe) {
                await this.subscribeToWallet(wallet);
            }

            console.log(`✓ Subscribed to ${walletsToSubscribe.size} wallets for alerts`);
        } catch (error) {
            console.error('Failed to resubscribe:', error.message);
        }
    }

    async onWalletActivity(wallet, data) {
        try {
            const alerts = await pool.query(`
        SELECT a.*, l.name as label_name, l.wallets as label_wallets
        FROM alert_settings a
        LEFT JOIN labels l ON a.label_id = l.id
        WHERE a.enabled = true
          AND (a.target_wallet = $1
               OR (a.label_id IS NOT NULL AND l.wallets::text LIKE '%' || $1 || '%'))
      `, [wallet]);

            for (const alert of alerts.rows) {
                await this.processAlert(alert, wallet, data);
            }
        } catch (error) {
            console.error('Error processing wallet activity:', error.message);
        }
    }

    async processAlert(alert, wallet, txData) {
        const { alert_type, label_name, owner_wallet } = alert;

        // Rate limit: 5 minutes per alert
        if (alert.last_notified_at) {
            const timeSince = Date.now() - new Date(alert.last_notified_at).getTime();
            if (timeSince < 5 * 60 * 1000) return;
        }

        // Fetch detailed transaction info
        const tx = await getRecentTransaction(wallet);

        let shouldNotify = false;
        let txType = 'activity';
        let txDetails = {};

        const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
        const displayName = label_name || walletShort;

        if (tx) {
            // Parse transaction type and details
            const type = tx.type || 'UNKNOWN';
            const description = tx.description || '';

            // Check for native SOL transfers
            if (tx.nativeTransfers?.length > 0) {
                for (const transfer of tx.nativeTransfers) {
                    if (transfer.toUserAccount === wallet) {
                        txType = 'incoming';
                        txDetails = {
                            amount: formatSol(transfer.amount),
                            from: `${transfer.fromUserAccount?.slice(0, 4)}...${transfer.fromUserAccount?.slice(-4)}`,
                            type: 'SOL'
                        };
                        break;
                    } else if (transfer.fromUserAccount === wallet) {
                        txType = 'outgoing';
                        txDetails = {
                            amount: formatSol(transfer.amount),
                            to: `${transfer.toUserAccount?.slice(0, 4)}...${transfer.toUserAccount?.slice(-4)}`,
                            type: 'SOL'
                        };
                        break;
                    }
                }
            }

            // Check for token transfers
            if (tx.tokenTransfers?.length > 0 && !txDetails.amount) {
                for (const transfer of tx.tokenTransfers) {
                    const symbol = transfer.tokenSymbol || transfer.mint?.slice(0, 6) || 'tokens';
                    if (transfer.toUserAccount === wallet) {
                        txType = 'incoming';
                        txDetails = {
                            amount: formatAmount(transfer.tokenAmount, transfer.decimals || 9, symbol),
                            from: `${transfer.fromUserAccount?.slice(0, 4)}...${transfer.fromUserAccount?.slice(-4)}`,
                            type: symbol
                        };
                        break;
                    } else if (transfer.fromUserAccount === wallet) {
                        txType = 'outgoing';
                        txDetails = {
                            amount: formatAmount(transfer.tokenAmount, transfer.decimals || 9, symbol),
                            to: `${transfer.toUserAccount?.slice(0, 4)}...${transfer.toUserAccount?.slice(-4)}`,
                            type: symbol
                        };
                        break;
                    }
                }
            }

            // Fallback to transaction type
            if (!txDetails.amount) {
                txDetails = {
                    type: type.replace(/_/g, ' ').toLowerCase(),
                    description: description.slice(0, 50)
                };
            }
        }

        // Check if alert type matches
        switch (alert_type) {
            case 'any_tx':
                shouldNotify = true;
                break;
            case 'incoming':
                shouldNotify = txType === 'incoming';
                break;
            case 'outgoing':
                shouldNotify = txType === 'outgoing';
                break;
            case 'threshold':
                // Handled separately via periodic check
                break;
        }

        if (shouldNotify) {
            const targetWallet = owner_wallet || wallet;
            await sendWalletActivityNotification(targetWallet, txType, txDetails, displayName, walletShort);
            await pool.query('UPDATE alert_settings SET last_notified_at = NOW() WHERE id = $1', [alert.id]);
        }
    }
}

export const heliusWS = new HeliusWebSocketManager();

