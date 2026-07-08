import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../config.js';
import { metrics, updateCacheSizes, getPercentile } from '../metrics.js';
import { validateTurnstileToken } from '../middleware/turnstile.js';
import { generateJwtToken } from '../utils/jwt.js';
import { resolveSNS } from '../utils/sns.js';
import { fetchJSON } from '../utils/fetch.js';

const router = Router();

router.get('/resolve/:domain', async (req: Request<{ domain: string }>, res: Response): Promise<void> => {
    try {
        const domain = req.params.domain;
        if (!domain.endsWith('.sol')) { res.json({ address: domain }); return; }
        const address = await resolveSNS(domain);
        if (address === domain) { res.status(404).json({ error: 'Domain not found', domain }); return; }
        res.json({ address, domain });
    } catch (error) {
        console.error('Resolve domain error:', error);
        res.status(500).json({ error: 'Failed to resolve domain' });
    }
});

router.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

router.get('/metrics', (req: Request, res: Response): void => {
    const providedSecret = (req.query.secret as string | undefined) || (req.headers['x-metrics-secret'] as string | undefined);
    // Length-mismatch means never-equal; otherwise use timingSafeEqual so we
    // don't leak the secret via response-time side channel.
    const a = Buffer.from(providedSecret || '');
    const b = Buffer.from(CONFIG.METRICS_SECRET);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Unauthorized' }); return;
    }
    updateCacheSizes();
    const uptimeMs = Date.now() - metrics.startTime;
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    const apiStats: Record<string, unknown> = {};
    for (const [provider, stats] of Object.entries(metrics.api)) {
        apiStats[provider] = {
            calls: stats.calls,
            errors: stats.errors,
            timeouts: stats.timeouts,
            avgLatencyMs: stats.calls > 0 ? Math.round(stats.totalLatencyMs / stats.calls) : 0,
            p50: getPercentile(stats.latencies, 50),
            p95: getPercentile(stats.latencies, 95),
            p99: getPercentile(stats.latencies, 99),
        };
    }

    res.json({
        uptime: `${uptimeHours}h ${uptimeMins}m`,
        cache: {
            hitRate: metrics.cache.hits + metrics.cache.misses > 0
                ? `${((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1)}%`
                : 'N/A',
            hits: metrics.cache.hits,
            misses: metrics.cache.misses,
            sizes: {
                holdings: metrics.cache.holdings.size,
                lambdaDefi: metrics.cache.lambdaDefi.size,
                dialectDefi: metrics.cache.dialectDefi.size,
                pnl: metrics.cache.pnl.size,
            },
        },
        api: apiStats,
        rateLimited: metrics.rateLimited,
        uniqueWallets: metrics.uniqueWallets.size,
        requests: metrics.requests,
    });
});

router.get('/turnstile-config', (_req, res) => {
    res.json({
        siteKey: CONFIG.TURNSTILE_SITE_KEY || null,
        enabled: !!CONFIG.TURNSTILE_SECRET_KEY,
    });
});

router.post('/turnstile/verify', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { token?: string; 'cf-turnstile-response'?: string } | undefined;
    const token = body?.token || body?.['cf-turnstile-response'];
    if (!token) { res.status(400).json({ success: false, error: 'Missing Turnstile token' }); return; }

    const remoteip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip) as string | undefined;
    const result = await validateTurnstileToken(token, remoteip);
    if (!result.success) { res.status(403).json({ success: false, error: 'Verification failed', details: result.error }); return; }

    res.json({ success: true, token: generateJwtToken(), expiresIn: 3600 });
});

const recentPings = new Map<string, number>();
const PING_DEDUP_MS = 60 * 60 * 1000;

function shouldSend(key: string): boolean {
    const now = Date.now();
    const last = recentPings.get(key);
    if (last && now - last < PING_DEDUP_MS) return false;
    recentPings.set(key, now);
    if (recentPings.size > 5000) {
        for (const [k, t] of recentPings) {
            if (now - t > PING_DEDUP_MS) recentPings.delete(k);
        }
    }
    return true;
}

type TelegramResult = { sent?: boolean; skipped?: boolean; error?: string };

async function sendTelegram(text: string): Promise<TelegramResult> {
    const token = CONFIG.TELEGRAM_BOT_TOKEN;
    const chatId = CONFIG.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { skipped: true };
    try {
        await fetchJSON(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
            },
            10_000,
        );
        return { sent: true };
    } catch (e) {
        console.error('Telegram ping failed:', (e as Error).message);
        return { error: (e as Error).message };
    }
}

type PingBody = { event?: 'signup' | 'usage'; wallet?: string; payload?: Record<string, unknown> | null };

router.post('/ping', async (req: Request, res: Response): Promise<void> => {
    const { event, wallet, payload } = (req.body as PingBody | undefined) || {};
    if (!event || !['signup', 'usage'].includes(event)) {
        res.status(400).json({ error: 'event must be signup or usage' });
        return;
    }
    if (!wallet || typeof wallet !== 'string') {
        res.status(400).json({ error: 'wallet required' });
        return;
    }

    const dedupKey = `${event}:${wallet}`;
    if (event === 'usage' && !shouldSend(dedupKey)) {
        res.json({ skipped: 'deduped' });
        return;
    }
    if (event === 'signup') recentPings.set(dedupKey, Date.now());

    const walletShort = `\`${wallet.slice(0, 6)}…${wallet.slice(-4)}\``;
    const tag = event === 'signup' ? '🎉 *Signup*' : '👋 *Active*';
    const extra = payload && typeof payload === 'object'
        ? Object.entries(payload).slice(0, 5).map(([k, v]) => `\n  ${k}: ${String(v)}`).join('')
        : '';
    const text = `${tag}\nwallet: ${walletShort}${extra}`;

    const result = await sendTelegram(text);
    res.json({ ok: true, ...result });
});

export default router;
