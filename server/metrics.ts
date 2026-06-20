import { holdingsCache, lambdaDefiCache, dialectDefiCache, pnlCache } from './cache.js';
import type { ApiProvider, ApiStats } from './types.js';

type Metrics = {
    startTime: number;
    cache: {
        hits: number;
        misses: number;
        holdings: { size: number };
        lambdaDefi: { size: number };
        dialectDefi: { size: number };
        pnl: { size: number };
    };
    api: Record<ApiProvider, ApiStats>;
    requests: { total: number; byEndpoint: Record<string, number> };
    rateLimited: { connected: number; unconnected: number };
    uniqueWallets: Set<string>;
};

export const metrics: Metrics = {
    startTime: Date.now(),
    cache: {
        hits: 0, misses: 0,
        holdings: { size: 0 }, lambdaDefi: { size: 0 }, dialectDefi: { size: 0 }, pnl: { size: 0 },
    },
    api: {
        birdeye: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
        lambda: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
        dialect: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
    },
    requests: { total: 0, byEndpoint: {} },
    rateLimited: { connected: 0, unconnected: 0 },
    uniqueWallets: new Set<string>(),
};

export function getApiProvider(url: string): ApiProvider | null {
    if (url.includes('birdeye.so')) return 'birdeye';
    if (url.includes('lambda.p2p.org')) return 'lambda';
    if (url.includes('dial.to')) return 'dialect';
    return null;
}

export function recordApiCall(provider: ApiProvider, latencyMs: number, error: unknown = null, isTimeout = false): void {
    const stats = metrics.api[provider];
    if (!stats) return;
    stats.calls++;
    stats.totalLatencyMs += latencyMs;
    stats.latencies.push(latencyMs);
    if (stats.latencies.length > 100) stats.latencies.shift();
    if (isTimeout) stats.timeouts++;
    else if (error) stats.errors++;
}

export function updateCacheSizes(): void {
    metrics.cache.holdings.size = holdingsCache.size;
    metrics.cache.lambdaDefi.size = lambdaDefiCache.size;
    metrics.cache.dialectDefi.size = dialectDefiCache.size;
    metrics.cache.pnl.size = pnlCache.size;
}

export function getPercentile(arr: number[], p: number): number {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
}
