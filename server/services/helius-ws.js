/**
 * Helius WebSocket Manager - Real-time wallet monitoring for alerts
 */

import WebSocket from 'ws';
import { HELIUS_WS_URL } from '../config.js';
import { pool } from '../db.js';
import { sendDialectNotification } from './dialect.js';

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
            const result = await pool.query(`
        SELECT DISTINCT target_wallet FROM alert_settings
        WHERE enabled = true AND target_wallet IS NOT NULL
        UNION
        SELECT DISTINCT jsonb_array_elements_text(l.wallets::jsonb->'address') as target_wallet
        FROM alert_settings a
        JOIN labels l ON a.label_id = l.id
        WHERE a.enabled = true AND a.label_id IS NOT NULL
      `);

            for (const row of result.rows) {
                if (row.target_wallet) {
                    await this.subscribeToWallet(row.target_wallet);
                }
            }

            console.log(`✓ Subscribed to ${result.rows.length} wallets for alerts`);
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
        const { alert_type, telegram_username, label_name } = alert;

        if (!telegram_username) return;

        // Rate limit: 5 minutes per alert
        if (alert.last_notified_at) {
            const timeSince = Date.now() - new Date(alert.last_notified_at).getTime();
            if (timeSince < 5 * 60 * 1000) return;
        }

        let shouldNotify = false;
        let message = '';
        const displayName = label_name || `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

        switch (alert_type) {
            case 'any_tx':
                shouldNotify = true;
                message = `🔔 Activity detected on ${displayName}`;
                break;
            case 'incoming':
                shouldNotify = true;
                message = `📥 Incoming transaction on ${displayName}`;
                break;
            case 'outgoing':
                shouldNotify = true;
                message = `📤 Outgoing transaction on ${displayName}`;
                break;
            case 'threshold':
                // Handled separately via periodic check
                break;
        }

        if (shouldNotify) {
            await sendDialectNotification(telegram_username, message, wallet);
            await pool.query('UPDATE alert_settings SET last_notified_at = NOW() WHERE id = $1', [alert.id]);
        }
    }
}

export const heliusWS = new HeliusWebSocketManager();

