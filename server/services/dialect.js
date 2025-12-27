/**
 * Dialect Notification Sender
 */

import { CONFIG } from '../config.js';

export async function sendDialectNotification(telegramUsername, message, wallet) {
    try {
        const response = await fetch('https://alerts-api.dial.to/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-dialect-api-key': CONFIG.DIALECT_API_KEY,
            },
            body: JSON.stringify({
                message: `${message}\n\n🔗 saul.run`,
                recipientWalletAddress: wallet,
            }),
        });

        if (response.ok) {
            console.log(`✓ Notification sent to ${telegramUsername}`);
        } else {
            const error = await response.text();
            console.error(`Failed to send notification: ${error}`);
        }
    } catch (error) {
        console.error('Dialect notification error:', error.message);
    }
}

