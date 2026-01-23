/**
 * Setup Dialect notification topics for portfolio.niks3089.com
 * Run this once to register notification types
 *
 * Usage: DAPP_PRIVATE_KEY=your_dapp_private_key node scripts/setup-dialect-topics.js
 */

import { Dialect } from '@dialectlabs/sdk';
import { NodeDialectSolanaWalletAdapter, SolanaSdkFactory } from '@dialectlabs/blockchain-sdk-solana';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const DAPP_PRIVATE_KEY = process.env.DAPP_PRIVATE_KEY; // Base58 encoded private key

async function setupTopics() {
    console.log('🔧 Setting up Dialect notification topics for portfolio.niks3089.com...\n');

    if (!DAPP_PRIVATE_KEY) {
        console.log('❌ DAPP_PRIVATE_KEY not set');
        console.log('');
        console.log('To create notification types, you need the private key of the dApp wallet.');
        console.log('This is the wallet you used to register the dApp in Dialect.');
        console.log('');
        console.log('Export your wallet private key (base58) and run:');
        console.log('  DAPP_PRIVATE_KEY=your_key node scripts/setup-dialect-topics.js');
        console.log('');
        process.exit(1);
    }

    try {
        // Create wallet from private key
        const keypair = Keypair.fromSecretKey(bs58.decode(DAPP_PRIVATE_KEY));
        console.log('✓ Wallet loaded:', keypair.publicKey.toBase58().slice(0, 8) + '...');

        const wallet = NodeDialectSolanaWalletAdapter.create(keypair);

        // Initialize SDK with Solana blockchain
        const sdk = Dialect.sdk(
            {
                environment: 'production',
            },
            SolanaSdkFactory.create({
                wallet,
            })
        );

        // Find the dApp
        const dapp = await sdk.dapps.find();

        if (!dapp) {
            console.error('❌ No dApp found for this wallet');
            console.log('Make sure you registered the dApp first using this wallet.');
            process.exit(1);
        }

        console.log('✓ Connected to dApp:', dapp.name);
        console.log('  Address:', dapp.address);

        // Define notification topics
        const topics = [
            {
                humanReadableId: 'wallet-activity',
                name: 'Wallet Activity',
                trigger: 'Get notified on incoming and outgoing transactions',
                orderingPriority: 0,
                defaultConfig: { enabled: true },
            },
            {
                humanReadableId: 'portfolio-change',
                name: 'Portfolio Change',
                trigger: 'Alert when your portfolio value changes significantly',
                orderingPriority: 1,
                defaultConfig: { enabled: true },
            },
        ];

        console.log('\n📋 Registering notification types...\n');

        for (const topic of topics) {
            try {
                await dapp.notificationTypes.create(topic);
                console.log(`✓ Created: ${topic.name} (${topic.humanReadableId})`);
            } catch (error) {
                if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
                    console.log(`⏭️ Already exists: ${topic.name} (${topic.humanReadableId})`);
                } else {
                    console.error(`❌ Failed to create ${topic.name}:`, error.message);
                }
            }
        }

        // List all notification types
        console.log('\n📋 Current notification types:');
        const types = await dapp.notificationTypes.findAll();
        for (const type of types) {
            console.log(`  - ${type.name} (${type.humanReadableId})`);
        }

        console.log('\n✅ Setup complete!');
        console.log('\nUsers will now see these notification toggles in the Dialect UI.');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

setupTopics();

