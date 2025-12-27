/**
 * Dialect Notification Sender
 * Uses Dialect v2 API to send alerts to subscribed users
 */

import { CONFIG } from '../config.js';

const DIALECT_APP_ID = 'ffb32fc6-5e32-47ba-acdf-3c77ce999360';

export async function sendDialectNotification(telegramUsername, message, wallet) {
    const username = telegramUsername.replace('@', '');

    console.log(`🔔 ALERT for @${username}: ${message}`);
    console.log(`   Wallet: ${wallet}`);

    // Use Dialect v2 API
    if (CONFIG.DIALECT_API_KEY) {
        try {
            const response = await fetch(`https://alerts-api.dial.to/v2/${DIALECT_APP_ID}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-dialect-api-key': CONFIG.DIALECT_API_KEY,
                },
                body: JSON.stringify({
                    recipient: {
                        type: 'subscribers',
                        walletAddresses: [wallet]
                    },
                    channels: ['TELEGRAM', 'IN_APP'],
                    message: {
                        title: '🔔 Saul.run Alert',
                        body: message
                    }
                }),
            });

            if (response.ok || response.status === 202) {
                console.log(`✓ Dialect notification sent to ${wallet.slice(0, 8)}...`);
                return true;
            } else {
                const error = await response.text();
                console.error(`Dialect API error (${response.status}): ${error}`);
            }
        } catch (error) {
            console.error('Dialect error:', error.message);
        }
    }

    return false;
}

