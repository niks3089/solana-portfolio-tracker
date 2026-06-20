/**
 * SNS (.sol) Domain Resolution using Bonfida SNS proxy
 */

// Cache resolved domains for 5 minutes
const snsCache = new Map();
const SNS_CACHE_TTL = 5 * 60 * 1000;

export async function resolveSNS(domain) {
    if (!domain.endsWith('.sol')) {
        return domain; // Not a .sol domain, return as-is
    }

    // Check cache first
    const cached = snsCache.get(domain);
    if (cached && Date.now() - cached.timestamp < SNS_CACHE_TTL) {
        return cached.address;
    }

    const name = domain.replace('.sol', '');

    try {
        const response = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`, {
            headers: { 'Accept': 'application/json' },
        });

        const data = await response.json();

        if (data.s === 'ok' && data.result) {
            console.log(`✓ Resolved ${domain} → ${data.result.slice(0, 8)}...`);
            snsCache.set(domain, { address: data.result, timestamp: Date.now() });
            return data.result;
        }

        console.warn(`Could not resolve ${domain}: ${data.s}`);
        return domain;
    } catch (error) {
        console.error(`SNS resolution error for ${domain}:`, error.message);
        return domain;
    }
}

