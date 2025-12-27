/**
 * Fetch Helper with Timeout and Metrics
 */

import { getApiProvider, recordApiCall } from '../metrics.js';

export async function fetchJSON(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();
    const urlHost = new URL(url).hostname;
    const provider = getApiProvider(url);

    try {
        const response = await fetch(url, {
            ...options,
            headers: { 'accept': 'application/json', ...options.headers },
            signal: controller.signal,
        });
        const elapsed = Date.now() - startTime;

        if (provider) recordApiCall(provider, elapsed);

        if (elapsed > 5000) {
            console.log(`⚠️ Slow API: ${urlHost} took ${elapsed}ms`);
        }
        return response.json();
    } catch (err) {
        const elapsed = Date.now() - startTime;
        const isTimeout = err.name === 'AbortError';

        if (provider) recordApiCall(provider, elapsed, err, isTimeout);

        if (isTimeout) {
            console.error(`⏱️ Timeout after ${timeoutMs}ms: ${urlHost}`);
            throw new Error(`Request timeout: ${urlHost}`);
        }
        console.error(`❌ Fetch error for ${urlHost}:`, err.message);
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

