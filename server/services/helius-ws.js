/**
 * Helius WebSocket Manager - Real-time wallet monitoring for alerts
 */

import WebSocket from 'ws';
import { HELIUS_WS_URL, CONFIG } from '../config.js';
const HELIUS_API_KEY = CONFIG.HELIUS_API_KEY;
import { pool } from '../db.js';
import { sendWalletActivityNotification } from './dialect-sdk.js';

// Fetch recent transaction details from Helius - find the most relevant one
async function getRecentTransaction(wallet) {
    try {
        // Fetch last 5 transactions to find the relevant one
        const response = await fetch(
            `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=5`
        );
        if (!response.ok) return null;
        const txs = await response.json();

        // Priority 1: Find token transfer where wallet is sender or receiver
        for (const tx of txs) {
            if (tx.tokenTransfers?.length > 0) {
                for (const transfer of tx.tokenTransfers) {
                    if (transfer.fromUserAccount === wallet || transfer.toUserAccount === wallet) {
                        console.log(`Found token transfer tx: ${tx.signature?.slice(0, 8)}...`);
                        return tx;
                    }
                }
            }
        }

        // Priority 2: Find significant SOL transfer (> 0.001 SOL) where wallet is sender/receiver
        for (const tx of txs) {
            if (tx.nativeTransfers?.length > 0) {
                for (const transfer of tx.nativeTransfers) {
                    const isSender = transfer.fromUserAccount === wallet;
                    const isReceiver = transfer.toUserAccount === wallet;
                    const isSignificant = transfer.amount > 1000000; // > 0.001 SOL

                    if ((isSender || isReceiver) && isSignificant) {
                        console.log(`Found SOL transfer tx: ${tx.signature?.slice(0, 8)}...`);
                        return tx;
                    }
                }
            }
        }

        // Fallback: return first transaction
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

// Token metadata cache
const tokenCache = new Map();

// Fetch token metadata from Helius DAS API
async function getTokenMetadata(mint) {
    if (tokenCache.has(mint)) {
        return tokenCache.get(mint);
    }

    try {
        const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'token-metadata',
                method: 'getAsset',
                params: { id: mint }
            })
        });

        if (!response.ok) return null;
        const data = await response.json();

        if (data.result) {
            const metadata = {
                symbol: data.result.token_info?.symbol || data.result.content?.metadata?.symbol || mint.slice(0, 4),
                decimals: data.result.token_info?.decimals || 9,
                price: data.result.token_info?.price_info?.price_per_token || null,
                name: data.result.content?.metadata?.name || null,
            };
            tokenCache.set(mint, metadata);
            return metadata;
        }
    } catch (e) {
        console.error('Failed to fetch token metadata:', e.message);
    }

    return { symbol: mint.slice(0, 4), decimals: 9, price: null, name: null };
}

// Format token amount (already human-readable from Helius API)
function formatAmount(amount, symbol = '') {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M ${symbol}`.trim();
    if (amount >= 1000) return `${(amount / 1000).toFixed(2)}K ${symbol}`.trim();
    if (amount >= 1) return `${amount.toFixed(2)} ${symbol}`.trim();
    if (amount >= 0.01) return `${amount.toFixed(4)} ${symbol}`.trim();
    return `${amount.toFixed(6)} ${symbol}`.trim();
}

// Format USD value
function formatUsd(amount) {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(2)}K`;
    if (amount >= 1) return `$${amount.toFixed(2)}`;
    return `$${amount.toFixed(4)}`;
}

class HeliusWebSocketManager {
    constructor() {
        this.ws = null;
        this.subscriptions = new Map(); // wallet -> subscriptionId
        this.walletRateLimits = new Map(); // wallet -> lastNotifiedAt (per-wallet rate limiting)
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

        // Rate limit: 10 seconds per wallet (not per alert)
        const rateLimitKey = `${alert.id}:${wallet}`;
        const lastNotified = this.walletRateLimits.get(rateLimitKey);
        if (lastNotified) {
            const timeSince = Date.now() - lastNotified;
            if (timeSince < 10 * 1000) return;
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

            // Priority 1: Check for token transfers FIRST (more specific)
            if (tx.tokenTransfers?.length > 0) {
                for (const transfer of tx.tokenTransfers) {
                    if (transfer.fromUserAccount === wallet || transfer.toUserAccount === wallet) {
                        // Fetch token metadata from DAS API
                        const tokenMeta = await getTokenMetadata(transfer.mint);
                        const symbol = tokenMeta.symbol;
                        const amount = transfer.tokenAmount; // Already human-readable from Helius

                        // Calculate USD value if price available
                        let usdValue = null;
                        if (tokenMeta.price && amount) {
                            usdValue = amount * tokenMeta.price;
                        }

                        if (transfer.toUserAccount === wallet) {
                            txType = 'incoming';
                            txDetails = {
                                amount: formatAmount(amount, symbol),
                                usdValue: usdValue ? formatUsd(usdValue) : null,
                                from: `${transfer.fromUserAccount?.slice(0, 4)}...${transfer.fromUserAccount?.slice(-4)}`,
                                type: symbol
                            };
                        } else {
                            txType = 'outgoing';
                            txDetails = {
                                amount: formatAmount(amount, symbol),
                                usdValue: usdValue ? formatUsd(usdValue) : null,
                                to: `${transfer.toUserAccount?.slice(0, 4)}...${transfer.toUserAccount?.slice(-4)}`,
                                type: symbol
                            };
                        }
                        break;
                    }
                }
            }

            // Priority 2: Check for significant native SOL transfers
            if (!txDetails.amount && tx.nativeTransfers?.length > 0) {
                for (const transfer of tx.nativeTransfers) {
                    const isSender = transfer.fromUserAccount === wallet;
                    const isReceiver = transfer.toUserAccount === wallet;
                    const isSignificant = transfer.amount > 1000000; // > 0.001 SOL

                    if ((isSender || isReceiver) && isSignificant) {
                        if (isReceiver) {
                            txType = 'incoming';
                            txDetails = {
                                amount: formatSol(transfer.amount),
                                from: `${transfer.fromUserAccount?.slice(0, 4)}...${transfer.fromUserAccount?.slice(-4)}`,
                                type: 'SOL'
                            };
                        } else {
                            txType = 'outgoing';
                            txDetails = {
                                amount: formatSol(transfer.amount),
                                to: `${transfer.toUserAccount?.slice(0, 4)}...${transfer.toUserAccount?.slice(-4)}`,
                                type: 'SOL'
                            };
                        }
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
            // Update per-wallet rate limit
            const rateLimitKey = `${alert.id}:${wallet}`;
            this.walletRateLimits.set(rateLimitKey, Date.now());
        }
    }
}

export const heliusWS = new HeliusWebSocketManager();

