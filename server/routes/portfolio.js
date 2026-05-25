/**
 * Portfolio API Routes
 */

import { Router } from 'express';
import { metrics } from '../metrics.js';
import { resolveSNS } from '../utils/sns.js';
import { authMiddleware } from '../middleware/turnstile.js';
import {
    getHoldings,
    getTokenPnL,
    getDefiPositionsFast,
    getDefiPositions,
    getDialectPositions,
    getPortfolioHistory,
} from '../services/portfolio.js';
import { getAggregateTradePnL, HeliusAuthError } from '../services/trade-pnl.js';

const router = Router();

// Require JWT authentication for all portfolio routes
router.use(authMiddleware);

// Temporary debug logging for all portfolio requests
router.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;
    const ua = req.headers['user-agent']?.slice(0, 60) || 'no-ua';
    console.log(`📊 [PORTFOLIO] ${req.method} ${req.path} | IP: ${ip} | UA: ${ua}`);
    next();
});

// Get single wallet portfolio
router.get('/:wallet', async (req, res) => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        metrics.uniqueWallets.add(wallet);
        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/:wallet'] = (metrics.requests.byEndpoint['/api/portfolio/:wallet'] || 0) + 1;

        const [holdings, defi] = await Promise.all([
            getHoldings(wallet),
            getDefiPositions(wallet),
        ]);

        const totalNetWorth = holdings.totalValue + defi.totalDeposits - defi.totalBorrows;

        res.json({
            wallet,
            totalNetWorth,
            totalTokens: holdings.totalValue,
            defiDeposits: defi.totalDeposits,
            defiBorrows: defi.totalBorrows,
            tokens: holdings.tokens,
            defiPositions: defi.positions,
        });
    } catch (error) {
        console.error('Portfolio error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

// Aggregate portfolio for multiple wallets
router.post('/aggregate', async (req, res) => {
    try {
        const { wallets: inputWallets } = req.body;
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;

        console.log(`📦 [AGGREGATE] Request from IP: ${ip} | wallets: ${inputWallets?.length || 0}`);

        if (!inputWallets?.length) {
            return res.status(400).json({ error: 'wallets array required' });
        }

        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/aggregate'] = (metrics.requests.byEndpoint['/api/portfolio/aggregate'] || 0) + 1;

        // Resolve SNS domains
        const wallets = await Promise.all(inputWallets.map(w => resolveSNS(w)));
        wallets.forEach(w => metrics.uniqueWallets.add(w));

        // Fetch all portfolios in parallel
        const portfolios = await Promise.all(
            wallets.map(async (wallet) => {
                try {
                    const [holdings, defi] = await Promise.all([
                        getHoldings(wallet),
                        getDefiPositions(wallet),
                    ]);
                    return { wallet, holdings, defi };
                } catch (e) {
                    return { wallet, error: e.message };
                }
            })
        );

        // Aggregate results
        let totalNetWorth = 0;
        let totalTokens = 0;
        let defiDeposits = 0;
        let defiBorrows = 0;
        let totalPnL = 0;

        const allTokens = [];
        const allDefiPositions = [];
        const walletSummaries = [];

        for (const p of portfolios) {
            if (p.error || !p.holdings) continue;

            const walletShort = `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`;

            const walletTokens = p.holdings.tokens || [];
            const walletDefi = p.defi || { positions: [], totalDeposits: 0, totalBorrows: 0 };

            totalTokens += p.holdings.totalValue || 0;
            defiDeposits += walletDefi.totalDeposits;
            defiBorrows += walletDefi.totalBorrows;

            for (const t of walletTokens) {
                allTokens.push({ ...t, wallet: p.wallet, walletShort });
            }

            for (const d of walletDefi.positions) {
                allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });
            }

            const netWorth = (p.holdings.totalValue || 0) + walletDefi.totalDeposits - walletDefi.totalBorrows;
            walletSummaries.push({
                wallet: p.wallet,
                summary: {
                    totalNetWorth: netWorth,
                    totalAssets: (p.holdings.totalValue || 0) + walletDefi.totalDeposits,
                    totalTokens: p.holdings.totalValue || 0,
                    defiDeposits: walletDefi.totalDeposits,
                    defiBorrows: walletDefi.totalBorrows,
                },
                tokens: walletTokens,
                defiPositions: walletDefi.positions,
            });
        }

        totalNetWorth = totalTokens + defiDeposits - defiBorrows;

        res.json({
            wallets,
            aggregate: {
                totalNetWorth,
                totalAssets: totalTokens + defiDeposits,
                totalTokens,
                defiDeposits,
                defiBorrows,
                totalPnL,
            },
            tokens: allTokens.sort((a, b) => b.value - a.value),
            defiPositions: allDefiPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
            portfolios: walletSummaries,
        });
    } catch (error) {
        console.error('Aggregate error:', error);
        res.status(500).json({ error: 'Failed to aggregate portfolios' });
    }
});

// Fast portfolio (no P&L, no Dialect)
router.get('/fast/:wallet', async (req, res) => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/fast'] = (metrics.requests.byEndpoint['/api/portfolio/fast'] || 0) + 1;

        const [holdings, defi] = await Promise.all([
            getHoldings(wallet),
            getDefiPositionsFast(wallet),
        ]);

        res.json({
            wallet,
            totalNetWorth: holdings.totalValue + defi.totalDeposits - defi.totalBorrows,
            totalTokens: holdings.totalValue,
            defiDeposits: defi.totalDeposits,
            defiBorrows: defi.totalBorrows,
            tokens: holdings.tokens,
            defiPositions: defi.positions,
        });
    } catch (error) {
        console.error('Fast portfolio error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

// Fast aggregate (no P&L, no Dialect)
router.post('/aggregate/fast', async (req, res) => {
    try {
        const { wallets: inputWallets } = req.body;
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;

        console.log(`⚡ [AGGREGATE/FAST] Request from IP: ${ip} | wallets: ${inputWallets?.length || 0}`);

        if (!inputWallets?.length) {
            return res.status(400).json({ error: 'wallets array required' });
        }

        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/aggregate/fast'] = (metrics.requests.byEndpoint['/api/portfolio/aggregate/fast'] || 0) + 1;

        const wallets = await Promise.all(inputWallets.map(w => resolveSNS(w)));
        wallets.forEach(w => metrics.uniqueWallets.add(w));

        const portfolios = await Promise.all(
            wallets.map(async (wallet) => {
                try {
                    const [holdings, defi] = await Promise.all([
                        getHoldings(wallet),
                        getDefiPositionsFast(wallet),
                    ]);
                    return { wallet, holdings, defi };
                } catch (e) {
                    return { wallet, error: e.message };
                }
            })
        );

        let totalNetWorth = 0;
        let totalTokens = 0;
        let defiDeposits = 0;
        let defiBorrows = 0;

        const allTokens = [];
        const allDefiPositions = [];

        for (const p of portfolios) {
            if (p.error || !p.holdings) continue;

            const walletShort = `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`;
            const walletTokens = p.holdings.tokens || [];
            const walletDefi = p.defi || { positions: [], totalDeposits: 0, totalBorrows: 0 };

            totalTokens += p.holdings.totalValue || 0;
            defiDeposits += walletDefi.totalDeposits;
            defiBorrows += walletDefi.totalBorrows;

            for (const t of walletTokens) {
                allTokens.push({ ...t, wallet: p.wallet, walletShort });
            }
            for (const d of walletDefi.positions) {
                allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });
            }
        }

        totalNetWorth = totalTokens + defiDeposits - defiBorrows;

        res.json({
            wallet: 'aggregate',
            aggregate: {
                totalNetWorth,
                totalAssets: totalTokens + defiDeposits,
                totalTokens,
                defiDeposits,
                defiBorrows,
            },
            tokens: allTokens.sort((a, b) => b.value - a.value),
            defiPositions: allDefiPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        });
    } catch (error) {
        console.error('Fast aggregate error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

// Trade-based P&L: scan Helius tx history for buy swaps, compare with today's price.
router.post('/trade-pnl', async (req, res) => {
    try {
        const { wallets: inputWallets } = req.body;
        if (!inputWallets?.length) {
            return res.status(400).json({ error: 'wallets array required' });
        }
        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/trade-pnl'] = (metrics.requests.byEndpoint['/api/portfolio/trade-pnl'] || 0) + 1;

        const wallets = await Promise.all(inputWallets.map(w => resolveSNS(w)));
        const holdings = await Promise.all(wallets.map(w => getHoldings(w)));
        const result = await getAggregateTradePnL(wallets, holdings);

        console.log(`📈 [TRADE-PNL] ${wallets.length} wallets → ${result.trades.length} priced tokens`);
        res.json(result);
    } catch (error) {
        if (error instanceof HeliusAuthError) {
            console.error('Trade P&L: Helius auth failed:', error.message);
            return res.status(503).json({
                error: 'Helius API key invalid',
                detail: 'Set HELIUS_API_KEY in the server environment to a valid key.',
            });
        }
        console.error('Trade P&L error:', error);
        res.status(500).json({ error: 'Failed to compute trade P&L' });
    }
});

// Get P&L for tokens (accepts wallets array, fetches holdings and calculates P&L)
router.post('/pnl', async (req, res) => {
    try {
        const { wallets, tokens } = req.body;
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;

        console.log(`💰 [PNL] Request from IP: ${ip} | wallets: ${wallets?.length || 0}, tokens: ${tokens?.length || 0}`);

        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/pnl'] = (metrics.requests.byEndpoint['/api/portfolio/pnl'] || 0) + 1;

        let tokenList = [];

        // If wallets provided, fetch holdings first to get token list
        if (wallets?.length) {
            const resolvedWallets = await Promise.all(wallets.map(w => resolveSNS(w)));
            console.log(`💰 [PNL] Fetching holdings for ${resolvedWallets.length} wallets...`);
            const holdingsResults = await Promise.all(
                resolvedWallets.map(async (wallet) => {
                    try {
                        const holdings = await getHoldings(wallet);
                        return (holdings.tokens || []).map(t => ({ address: t.address, wallet }));
                    } catch (e) {
                        return [];
                    }
                })
            );
            tokenList = holdingsResults.flat();
            console.log(`💰 [PNL] Found ${tokenList.length} tokens across all wallets - will make ${tokenList.length} Birdeye P&L calls!`);
        } else if (tokens?.length) {
            tokenList = tokens;
        }

        if (!tokenList.length) {
            return res.json({ totalPnL: 0, tokenPnLs: [] });
        }

        // Fetch P&L for each token
        const pnlResults = await Promise.all(
            tokenList.map(async ({ address, wallet }) => {
                const pnl = await getTokenPnL(address, wallet);
                return pnl ? { ...pnl, address, wallet } : null;
            })
        );

        const validPnLs = pnlResults.filter(Boolean);
        const totalPnL = validPnLs.reduce((sum, p) => sum + (p.totalPnL || 0), 0);

        console.log(`💰 [PNL] Complete: ${validPnLs.length} P&L results, total: $${totalPnL.toFixed(2)}`);

        res.json({ totalPnL, tokenPnLs: validPnLs });
    } catch (error) {
        console.error('PnL error:', error);
        res.status(500).json({ error: 'Failed to fetch P&L' });
    }
});

// Get Dialect DeFi positions
router.post('/dialect', async (req, res) => {
    try {
        const { wallets } = req.body;
        if (!wallets?.length) {
            return res.json({ positions: [] });
        }

        metrics.requests.total++;
        metrics.requests.byEndpoint['/api/portfolio/dialect'] = (metrics.requests.byEndpoint['/api/portfolio/dialect'] || 0) + 1;

        const allPositions = [];
        for (const wallet of wallets) {
            const positions = await getDialectPositions(wallet);
            const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
            for (const p of positions) {
                allPositions.push({ ...p, wallet, walletShort });
            }
        }

        res.json({ positions: allPositions });
    } catch (error) {
        console.error('Dialect error:', error);
        res.status(500).json({ error: 'Failed to fetch Dialect positions' });
    }
});

// Get portfolio history
router.get('/history/:wallet', async (req, res) => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        const days = parseInt(req.query.days) || 7;
        const history = await getPortfolioHistory(wallet, days);
        res.json({ wallet, history });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

export default router;

