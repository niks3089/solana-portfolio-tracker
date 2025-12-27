/**
 * Metrics Tracking
 */

import { holdingsCache, lambdaDefiCache, dialectDefiCache, pnlCache } from './cache.js';

export const metrics = {
    startTime: Date.now(),

    cache: {
        hits: 0,
        misses: 0,
        holdings: { size: 0 },
        lambdaDefi: { size: 0 },
        dialectDefi: { size: 0 },
        pnl: { size: 0 },
    },

    api: {
        birdeye: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
        lambda: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
        dialect: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
    },

    requests: {
        total: 0,
        byEndpoint: {},
    },

    rateLimited: {
        connected: 0,
        unconnected: 0,
    },

    uniqueWallets: new Set(),
};

export function getApiProvider(url) {
    if (url.includes('birdeye.so')) return 'birdeye';
    if (url.includes('lambda.p2p.org')) return 'lambda';
    if (url.includes('dial.to')) return 'dialect';
    return null;
}

export function recordApiCall(provider, latencyMs, error = null, isTimeout = false) {
    if (!metrics.api[provider]) return;

    const stats = metrics.api[provider];
    stats.calls++;
    stats.totalLatencyMs += latencyMs;

    // Keep last 100 latencies for percentile calculation
    stats.latencies.push(latencyMs);
    if (stats.latencies.length > 100) stats.latencies.shift();

    if (isTimeout) stats.timeouts++;
    else if (error) stats.errors++;
}

export function updateCacheSizes() {
    metrics.cache.holdings.size = holdingsCache.size;
    metrics.cache.lambdaDefi.size = lambdaDefiCache.size;
    metrics.cache.dialectDefi.size = dialectDefiCache.size;
    metrics.cache.pnl.size = pnlCache.size;
}

export function getPercentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

