import { getApiProvider, recordApiCall } from '../metrics.js';

type FetchOptions = RequestInit & { headers?: Record<string, string> };

export async function fetchJSON<T = unknown>(url: string, options: FetchOptions = {}, timeoutMs = 15_000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();
    const urlHost = new URL(url).hostname;
    const provider = getApiProvider(url);

    const urlPath = new URL(url).pathname;
    const walletMatch = url.match(/wallet[s]?=([A-Za-z0-9]{32,44})/i) || url.match(/\/([A-Za-z0-9]{32,44})(?:\/|$|\?)/);
    const walletShort = walletMatch ? `${walletMatch[1]!.slice(0, 4)}...${walletMatch[1]!.slice(-4)}` : 'N/A';

    console.log(`🌐 [API] ${provider?.toUpperCase() || urlHost} | ${urlPath.slice(0, 50)} | wallet: ${walletShort}`);

    try {
        const response = await fetch(url, {
            ...options,
            headers: { accept: 'application/json', ...(options.headers || {}) },
            signal: controller.signal,
        });
        const elapsed = Date.now() - startTime;
        if (provider) recordApiCall(provider, elapsed);
        if (elapsed > 5000) console.log(`⚠️ Slow API: ${urlHost} took ${elapsed}ms`);
        return (await response.json()) as T;
    } catch (err) {
        const elapsed = Date.now() - startTime;
        const e = err as { name?: string; message?: string };
        const isTimeout = e.name === 'AbortError';
        if (provider) recordApiCall(provider, elapsed, err, isTimeout);
        if (isTimeout) {
            console.error(`⏱️ Timeout after ${timeoutMs}ms: ${urlHost}`);
            throw new Error(`Request timeout: ${urlHost}`);
        }
        console.error(`❌ Fetch error for ${urlHost}:`, e.message);
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}
