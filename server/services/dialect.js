/**
 * Notification Sender
 * Sends alerts via Telegram bot (if configured) or logs for manual delivery
 */

import { CONFIG } from '../config.js';

export async function sendDialectNotification(telegramUsername, message, wallet) {
    const username = telegramUsername.replace('@', '');

    console.log(`🔔 ALERT for @${username}: ${message}`);
    console.log(`   Wallet: ${wallet}`);

    // Try direct Telegram bot if configured
    if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
        try {
            const telegramMsg = `🔔 *Saul.run Alert*\n\n${message}\n\n👤 User: @${username}\n💼 Wallet: \`${wallet.slice(0, 8)}...${wallet.slice(-4)}\``;

            const response = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CONFIG.TELEGRAM_CHAT_ID,
                    text: telegramMsg,
                    parse_mode: 'Markdown'
                })
            });

            if (response.ok) {
                console.log(`✓ Telegram notification sent`);
                return true;
            } else {
                const err = await response.text();
                console.error(`Telegram API error: ${err}`);
            }
        } catch (error) {
            console.error('Telegram error:', error.message);
        }
    }

    // Try Dialect API
    if (CONFIG.DIALECT_API_KEY) {
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
                console.log(`✓ Dialect notification sent`);
                return true;
            }
        } catch (error) {
            console.error('Dialect error:', error.message);
        }
    }

    return false;
}

