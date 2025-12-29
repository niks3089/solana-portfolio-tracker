/**
 * Dialect SDK Notification Service
 * Uses @dialectlabs/sdk for notifications
 */

import { Dialect } from '@dialectlabs/sdk';
import { SolanaSdkFactory, NodeDialectSolanaWalletAdapter } from '@dialectlabs/blockchain-sdk-solana';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG, HELIUS_RPC } from '../config.js';

let sdk = null;
let dapp = null;

// Notification type UUIDs from Dialect dashboard
const NOTIFICATION_TYPES = {
    WALLET_ACTIVITY: '44106a0b-6923-4ec1-b96c-47aabf9ba5ad',
    PORTFOLIO_CHANGE: 'dd2c4471-1963-44b6-af6d-6cd98ce6bae8',
};

// Initialize Dialect SDK
export async function initDialectSDK() {
    if (!CONFIG.DIALECT_PRIVATE_KEY) {
        console.warn('⚠️ DIALECT_PRIVATE_KEY not set, notifications disabled');
        return null;
    }

    try {
        // Parse private key (supports JSON array, base58, or base64)
        let secretKey;
        if (CONFIG.DIALECT_PRIVATE_KEY.startsWith('[')) {
            secretKey = new Uint8Array(JSON.parse(CONFIG.DIALECT_PRIVATE_KEY));
        } else if (CONFIG.DIALECT_PRIVATE_KEY.includes('/') || CONFIG.DIALECT_PRIVATE_KEY.includes('+')) {
            secretKey = new Uint8Array(Buffer.from(CONFIG.DIALECT_PRIVATE_KEY, 'base64'));
        } else {
            secretKey = bs58.decode(CONFIG.DIALECT_PRIVATE_KEY);
        }

        const keypair = Keypair.fromSecretKey(secretKey);
        console.log(`✓ Dialect keypair: ${keypair.publicKey.toString().slice(0, 8)}...`);

        // Create wallet adapter
        const wallet = NodeDialectSolanaWalletAdapter.create(keypair);

        // Create Solana SDK factory
        const solanaSdk = SolanaSdkFactory.create({
            wallet,
            rpcUrl: HELIUS_RPC,
        });

        // Initialize Dialect SDK
        sdk = Dialect.sdk({ environment: 'production' }, solanaSdk);

        // Find or create dapp
        try {
            dapp = await sdk.dapps.find();
            if (dapp) {
                console.log('✓ Dialect dapp found');
            }
        } catch (e) {
            console.log('No dapp found, creating...');
        }

        if (!dapp) {
            try {
                dapp = await sdk.dapps.create({
                    name: 'Saul.run',
                    description: 'Solana Portfolio Tracker',
                });
                console.log('✓ Dialect dapp created');
            } catch (e) {
                console.error('Failed to create dapp:', e.message);
            }
        }

        console.log('✓ Dialect SDK initialized');
        return sdk;
    } catch (error) {
        console.error('Dialect SDK init error:', error.message);
        return null;
    }
}

// Send notification
export async function sendNotification({ recipient, title, body, notificationTypeId }) {
    if (!sdk || !dapp) {
        console.warn('Dialect SDK not ready');
        return false;
    }

    const msgTitle = String(title || 'Alert');
    const msgBody = String(body || 'Notification from saul.run');

    console.log(`📤 Sending notification: to=${recipient.slice(0, 8)}... title="${msgTitle}" body="${msgBody}"`);

    try {
        await dapp.messages.send({
            recipient: new PublicKey(recipient),
            title: msgTitle,
            message: msgBody,
            notificationTypeId: notificationTypeId || NOTIFICATION_TYPES.WALLET_ACTIVITY,
        });
        console.log(`✓ Notification sent to ${recipient.slice(0, 8)}...`);
        return true;
    } catch (error) {
        console.error('Dialect send error:', error);
        return false;
    }
}

// Send wallet activity notification
export async function sendWalletActivityNotification(walletAddress, txType, txDetails, displayName, walletShort) {
    let title, body;

    if (txType === 'incoming') {
        title = '💰 Received';
        if (txDetails.amount) {
            const usdLine = txDetails.usdValue ? ` (${txDetails.usdValue})` : '';
            body = `+${txDetails.amount}${usdLine}\n📍 ${displayName} (${walletShort})\n📤 From: ${txDetails.from || 'unknown'}`;
        } else {
            body = `Funds received\n📍 ${displayName} (${walletShort})`;
        }
    } else if (txType === 'outgoing') {
        title = '📤 Sent';
        if (txDetails.amount) {
            const usdLine = txDetails.usdValue ? ` (${txDetails.usdValue})` : '';
            body = `-${txDetails.amount}${usdLine}\n📍 ${displayName} (${walletShort})\n📥 To: ${txDetails.to || 'unknown'}`;
        } else {
            body = `Funds sent\n📍 ${displayName} (${walletShort})`;
        }
    } else {
        title = '🔔 Activity';
        if (txDetails.type && txDetails.type !== 'unknown') {
            body = `${txDetails.type}\n📍 ${displayName} (${walletShort})`;
        } else {
            body = `Transaction detected\n📍 ${displayName} (${walletShort})`;
        }
    }

    return sendNotification({
        recipient: walletAddress,
        title,
        body,
        notificationTypeId: NOTIFICATION_TYPES.WALLET_ACTIVITY,
    });
}

// Send portfolio change notification
export async function sendPortfolioChangeNotification(walletAddress, percentChange, newValue) {
    const isPositive = percentChange >= 0;
    const emoji = isPositive ? '📈' : '📉';
    const direction = isPositive ? 'up' : 'down';

    return sendNotification({
        recipient: walletAddress,
        title: `${emoji} Portfolio ${direction} ${Math.abs(percentChange).toFixed(1)}%`,
        body: `Your portfolio is now worth $${newValue.toLocaleString()}.`,
        notificationTypeId: NOTIFICATION_TYPES.PORTFOLIO_CHANGE,
    });
}
