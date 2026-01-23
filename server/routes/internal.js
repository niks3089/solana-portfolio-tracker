/**
 * Internal API Routes (Snapshots, Metrics, Auth)
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { CONFIG } from '../config.js';
import { metrics, updateCacheSizes, getPercentile } from '../metrics.js';
import { getHoldings, getDefiPositionsFast } from '../services/portfolio.js';
import { validateTurnstileToken } from '../middleware/turnstile.js';
import { generateJwtToken } from '../utils/jwt.js';
import { resolveSNS } from '../utils/sns.js';

const router = Router();

// Resolve .sol domain to wallet address
router.get('/resolve/:domain', async (req, res) => {
    try {
        const { domain } = req.params;
        
        if (!domain.endsWith('.sol')) {
            return res.json({ address: domain });
        }
        
        const address = await resolveSNS(domain);
        
        if (address === domain) {
            // Resolution failed, domain returned as-is
            return res.status(404).json({ error: 'Domain not found', domain });
        }
        
        res.json({ address, domain });
    } catch (error) {
        console.error('Resolve domain error:', error);
        res.status(500).json({ error: 'Failed to resolve domain' });
    }
});

// Health check endpoint (no auth required)
router.get('/health', async (req, res) => {
    try {
        // Test database connection
        const dbResult = await pool.query('SELECT 1 as ok');
        const dbOk = dbResult.rows[0]?.ok === 1;

        // Get basic stats
        const statsResult = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM labels) as portfolios
        `);
        const stats = statsResult.rows[0];

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbOk ? 'connected' : 'error',
            stats: {
                users: parseInt(stats.users),
                portfolios: parseInt(stats.portfolios)
            }
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Daily snapshot cron endpoint
router.post('/snapshot', async (req, res) => {
    try {
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;
        const ua = req.headers['user-agent']?.slice(0, 60) || 'no-ua';
        console.log(`📸 [SNAPSHOT] Called from IP: ${ip} | UA: ${ua}`);

        const providedSecret = req.query.secret || req.headers['x-snapshot-secret'];
        if (providedSecret !== CONFIG.SNAPSHOT_SECRET) {
            console.log(`📸 [SNAPSHOT] ❌ Unauthorized attempt from IP: ${ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log(`📸 [SNAPSHOT] ✓ Authorized, processing labels...`);

        // Get labels that haven't been snapshotted today
        const labelsResult = await pool.query(`
      SELECT l.* FROM labels l
      WHERE l.wallets IS NOT NULL AND jsonb_array_length(l.wallets) > 0
        AND NOT EXISTS (
          SELECT 1 FROM label_snapshots s
          WHERE s.label_id = l.id AND s.snapshot_date = CURRENT_DATE
        )
      LIMIT 10
    `);

        const results = [];

        for (const label of labelsResult.rows) {
            try {
                const wallets = label.wallets || [];
                if (wallets.length === 0) continue;

                let totalTokens = 0;
                let defiDeposits = 0;
                let defiBorrows = 0;

                for (const w of wallets) {
                    try {
                        const [holdings, defi] = await Promise.all([
                            getHoldings(w.address),
                            getDefiPositionsFast(w.address),
                        ]);
                        totalTokens += holdings.totalValue || 0;
                        defiDeposits += defi.totalDeposits || 0;
                        defiBorrows += defi.totalBorrows || 0;
                    } catch (e) {
                        console.error(`Snapshot wallet error ${w.address}:`, e.message);
                    }
                }

                const totalNetWorth = totalTokens + defiDeposits - defiBorrows;

                await pool.query(`
          INSERT INTO label_snapshots (label_id, total_net_worth, total_tokens, defi_deposits, defi_borrows, wallet_count)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (label_id, snapshot_date) DO UPDATE SET
            total_net_worth = $2, total_tokens = $3, defi_deposits = $4, defi_borrows = $5, wallet_count = $6
        `, [label.id, totalNetWorth, totalTokens, defiDeposits, defiBorrows, wallets.length]);

                results.push({ labelId: label.id, name: label.name, totalNetWorth, success: true });
            } catch (e) {
                results.push({ labelId: label.id, name: label.name, error: e.message });
            }
        }

        res.json({
            success: true,
            processed: results.length,
            results,
        });
    } catch (error) {
        console.error('Snapshot error:', error);
        res.status(500).json({ error: 'Snapshot failed' });
    }
});

// Metrics endpoint
router.get('/metrics', async (req, res) => {
    try {
        const providedSecret = req.query.secret || req.headers['x-metrics-secret'];
        if (providedSecret !== CONFIG.METRICS_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        updateCacheSizes();

        const uptimeMs = Date.now() - metrics.startTime;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

        // Calculate API stats
        const apiStats = {};
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

        // Get DB stats
        let dbStats = {};
        try {
            const userCount = await pool.query('SELECT COUNT(*) FROM users');
            const paymentCount = await pool.query('SELECT COUNT(*) FROM payments WHERE status = $1', ['active']);
            const labelCount = await pool.query('SELECT COUNT(*) FROM labels');
            const alertCount = await pool.query('SELECT COUNT(*) FROM alert_settings WHERE enabled = true');

            dbStats = {
                users: parseInt(userCount.rows[0].count),
                activePayments: parseInt(paymentCount.rows[0].count),
                labels: parseInt(labelCount.rows[0].count),
                activeAlerts: parseInt(alertCount.rows[0].count),
            };
        } catch (e) {
            dbStats = { error: e.message };
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
            db: dbStats,
            uniqueWallets: metrics.uniqueWallets.size,
            requests: metrics.requests,
        });
    } catch (error) {
        console.error('Metrics error:', error);
        res.status(500).json({ error: 'Failed to get metrics' });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Turnstile config (returns site key for frontend)
router.get('/turnstile-config', (req, res) => {
    res.json({
        siteKey: CONFIG.TURNSTILE_SITE_KEY || null,
        enabled: !!CONFIG.TURNSTILE_SECRET_KEY,
    });
});

// Turnstile verification - exchanges Turnstile token for JWT
router.post('/turnstile/verify', async (req, res) => {
    const token = req.body?.token || req.body?.['cf-turnstile-response'];

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Missing Turnstile token',
        });
    }

    const remoteip = req.headers['cf-connecting-ip'] ||
                     req.headers['x-real-ip'] ||
                     req.ip;

    const result = await validateTurnstileToken(token, remoteip);

    if (!result.success) {
        console.log(`🤖 Turnstile verify failed: ${remoteip} | ${result.error}`);
        return res.status(403).json({
            success: false,
            error: 'Verification failed',
            details: result.error,
        });
    }

    // Generate JWT token (valid for 1 hour)
    const jwtToken = generateJwtToken();

    console.log(`✅ JWT issued: ${remoteip}`);

    res.json({
        success: true,
        token: jwtToken,
        expiresIn: 3600, // 1 hour in seconds
    });
});

export default router;

