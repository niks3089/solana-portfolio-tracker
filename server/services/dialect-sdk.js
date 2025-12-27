/**
 * Dialect Notification Service
 * Uses REST API to send notifications to subscribed users
 */

import { CONFIG } from '../config.js';

const DAPP_ID = 'ffb32fc6-5e32-47ba-acdf-3c77ce999360'; // saul.run app ID
const API_BASE = 'https://alerts-api.dial.to/v2';

let initialized = false;

// Initialize (just validates API key exists)
export async function initDialectSDK() {
    if (!CONFIG.DIALECT_API_KEY) {
        console.warn('⚠️ DIALECT_API_KEY not set, notifications disabled');
        return null;
    }

    initialized = true;
    console.log('✓ Dialect notifications enabled');
    return true;
}

// Send notification via REST API
async function sendMessage(payload) {
    if (!initialized || !CONFIG.DIALECT_API_KEY) {
        console.warn('Dialect not initialized');
        return false;
    }

    try {
        const response = await fetch(`${API_BASE}/${DAPP_ID}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dialect-Client-Key': CONFIG.DIALECT_API_KEY,
            },
            body: JSON.stringify(payload),
        });

        if (response.ok || response.status === 202) {
            console.log('✓ Notification sent');
            return true;
        } else {
            const text = await response.text();
            console.error(`Dialect API error (${response.status}):`, text);
            return false;
        }
    } catch (error) {
        console.error('Dialect send error:', error.message);
        return false;
    }
}

// Send notification to a specific wallet
export async function sendNotification({ recipient, title, message, notificationTypeId, actionUrl, actionLabel }) {
    const payload = {
        recipient: {
            type: 'walletAddress',
            walletAddress: recipient,
        },
        message: {
            title,
            body: message,
        },
    };

    // Add notification type if specified
    if (notificationTypeId) {
        payload.notificationTypeId = notificationTypeId;
    }

    // Add action if specified
    if (actionUrl && actionLabel) {
        payload.message.actions = [{
            type: 'link',
            label: actionLabel,
            url: actionUrl,
        }];
    }

    return sendMessage(payload);
}

// Send wallet activity notification
export async function sendWalletActivityNotification(walletAddress, txType, displayName) {
    let title, message;

    if (txType === 'incoming') {
        title = '💰 Incoming Transaction';
        message = `Funds received on ${displayName}`;
    } else if (txType === 'outgoing') {
        title = '📤 Outgoing Transaction';
        message = `Funds sent from ${displayName}`;
    } else {
        title = '🔔 Wallet Activity';
        message = `Activity detected on ${displayName}`;
    }

    return sendNotification({
        recipient: walletAddress,
        title,
        message,
        notificationTypeId: 'wallet-activity',
        actionUrl: 'https://saul.run',
        actionLabel: 'View Portfolio',
    });
}

// Send portfolio change notification
export async function sendPortfolioChangeNotification(walletAddress, percentChange, newValue) {
    const isPositive = percentChange >= 0;
    const emoji = isPositive ? '📈' : '📉';
    const direction = isPositive ? 'up' : 'down';

    const title = `${emoji} Portfolio ${direction} ${Math.abs(percentChange).toFixed(1)}%`;
    const message = `Your portfolio is now worth $${newValue.toLocaleString()}.`;

    return sendNotification({
        recipient: walletAddress,
        title,
        message,
        notificationTypeId: 'portfolio-change',
        actionUrl: 'https://saul.run',
        actionLabel: 'View Details',
    });
}

// Broadcast to all subscribers
export async function broadcastNotification({ title, message, notificationTypeId }) {
    const payload = {
        message: {
            title,
            body: message,
        },
    };

    if (notificationTypeId) {
        payload.notificationTypeId = notificationTypeId;
    }

    return sendMessage(payload);
}

