/**
 * SNS (.sol) Domain Resolution
 */

import { HELIUS_RPC } from '../config.js';

export async function resolveSNS(domain) {
    if (!domain.endsWith('.sol')) {
        return domain; // Not a .sol domain, return as-is
    }

    try {
        const response = await fetch(HELIUS_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAssetsByOwner',
                params: {
                    ownerAddress: domain,
                    page: 1,
                    limit: 1,
                },
            }),
        });

        const data = await response.json();

        // If the domain resolved to assets, get the owner
        if (data.result?.items?.length > 0) {
            const ownerAddress = data.result.items[0].ownership?.owner;
            if (ownerAddress) {
                console.log(`✓ Resolved ${domain} → ${ownerAddress.slice(0, 8)}...`);
                return ownerAddress;
            }
        }

        // Fallback: try SNS resolution via different method
        const snsResponse = await fetch(HELIUS_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'resolveRecords',
                params: {
                    name: domain.replace('.sol', ''),
                },
            }),
        });

        const snsData = await snsResponse.json();
        if (snsData.result?.owner) {
            return snsData.result.owner;
        }

        console.warn(`Could not resolve ${domain}`);
        return domain;
    } catch (error) {
        console.error(`SNS resolution error for ${domain}:`, error.message);
        return domain;
    }
}

