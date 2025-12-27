/**
 * Setup Dialect notification topics for saul.run
 * Run this once to register notification types
 * 
 * Usage: DIALECT_API_KEY=your_key node scripts/setup-dialect-topics.js
 */

const DIALECT_API_KEY = process.env.DIALECT_API_KEY;
const DAPP_ID = process.env.DAPP_ID || 'ffb32fc6-5e32-47ba-acdf-3c77ce999360'; // saul.run app ID

if (!DIALECT_API_KEY) {
    console.error('❌ DIALECT_API_KEY environment variable required');
    console.log('Usage: DIALECT_API_KEY=your_key node scripts/setup-dialect-topics.js');
    process.exit(1);
}

const BASE_URL = 'https://alerts-api.dial.to/v2';

async function apiCall(method, path, body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DIALECT_API_KEY}`,
        },
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${BASE_URL}${path}`, options);
    const text = await response.text();
    
    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${text}`);
    }
    
    return text ? JSON.parse(text) : null;
}

async function setupTopics() {
    console.log('🔧 Setting up Dialect notification topics for saul.run...\n');
    console.log('App ID:', DAPP_ID);

    try {
        // Get current dapp info
        const dappInfo = await apiCall('GET', `/${DAPP_ID}`);
        console.log('✓ Connected to dapp:', dappInfo?.name || 'saul');

        // Define notification topics
        const topics = [
            {
                humanReadableId: 'wallet-activity',
                name: 'Wallet Activity',
                description: 'Get notified on incoming and outgoing transactions',
            },
            {
                humanReadableId: 'portfolio-change', 
                name: 'Portfolio Change',
                description: 'Alert when your portfolio value changes significantly',
            },
        ];

        console.log('\n📋 Registering notification types...\n');

        for (const topic of topics) {
            try {
                await apiCall('POST', `/${DAPP_ID}/notification-types`, {
                    humanReadableId: topic.humanReadableId,
                    name: topic.name,
                    description: topic.description,
                    defaultConfig: { enabled: true },
                });
                console.log(`✓ Created: ${topic.name} (${topic.humanReadableId})`);
            } catch (error) {
                if (error.message?.includes('already exists') || error.message?.includes('409')) {
                    console.log(`⏭️ Already exists: ${topic.name} (${topic.humanReadableId})`);
                } else {
                    console.error(`❌ Failed to create ${topic.name}:`, error.message);
                }
            }
        }

        // List all notification types
        console.log('\n📋 Getting current notification types...');
        try {
            const types = await apiCall('GET', `/${DAPP_ID}/notification-types`);
            console.log('Current notification types:');
            if (Array.isArray(types)) {
                for (const type of types) {
                    console.log(`  - ${type.name} (${type.humanReadableId})`);
                }
            } else {
                console.log('  Response:', JSON.stringify(types, null, 2));
            }
        } catch (e) {
            console.log('  Could not list types:', e.message);
        }

        console.log('\n✅ Setup complete!');
        console.log('\nUsers will now see these notification toggles in the Dialect UI.');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

setupTopics();

