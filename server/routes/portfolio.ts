import { Router, type Request, type Response } from 'express';
import { metrics } from '../metrics.js';
import { resolveSNS } from '../utils/sns.js';
import { authMiddleware } from '../middleware/turnstile.js';
import {
    getHoldings, getTokenPnL, getDefiPositionsFast, getDefiPositions,
    getDialectPositions, getLambdaPositions, getPortfolioHistory,
    dropDefiDuplicateTokens, filterStaleDialect,
} from '../services/portfolio.js';
import { getAggregateTradePnL, HeliusAuthError } from '../services/trade-pnl.js';
import { fetchJSON } from '../utils/fetch.js';
import type { DefiSummary, Holdings, TokenPnL } from '../types.js';

const router = Router();
router.use(authMiddleware);

type WalletParam = { wallet: string };
type WalletsBody = { wallets?: string[] };

const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR'] as const;
let fxCache: { ts: number; rates: Record<string, number> } | null = null;

router.get('/fx', async (_req: Request, res: Response): Promise<void> => {
    try {
        if (!fxCache || Date.now() - fxCache.ts > 6 * 60 * 60 * 1000) {
            type Resp = { result?: string; rates?: Record<string, number> };
            const data = await fetchJSON<Resp>('https://open.er-api.com/v6/latest/USD');
            if (data?.result === 'success' && data.rates) {
                fxCache = { ts: Date.now(), rates: data.rates };
            }
        }
        if (!fxCache) {
            res.status(503).json({ error: 'FX rates unavailable' });
            return;
        }
        const rates: Record<string, number> = {};
        for (const c of FX_CURRENCIES) {
            const r = c === 'USD' ? 1 : fxCache.rates[c];
            if (r && r > 0) rates[c] = r;
        }
        res.json({ rates, updatedAt: fxCache.ts });
    } catch (error) {
        console.error('FX error:', error);
        res.status(500).json({ error: 'Failed to fetch FX rates' });
    }
});

router.get('/:wallet', async (req: Request<WalletParam>, res: Response): Promise<void> => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        metrics.uniqueWallets.add(wallet);
        metrics.requests.total++;

        const [rawHoldings, defi] = await Promise.all([getHoldings(wallet), getDefiPositions(wallet)]);
        const holdings = dropDefiDuplicateTokens(rawHoldings, defi);
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

type WalletResult = { wallet: string; holdings?: Holdings; defi?: DefiSummary; error?: string };

router.post('/aggregate', async (req: Request<unknown, unknown, WalletsBody>, res: Response): Promise<void> => {
    try {
        const inputWallets = req.body?.wallets;
        if (!inputWallets?.length) { res.status(400).json({ error: 'wallets array required' }); return; }

        metrics.requests.total++;
        const wallets = await Promise.all(inputWallets.map((w) => resolveSNS(w)));
        wallets.forEach((w) => metrics.uniqueWallets.add(w));

        const portfolios = await Promise.all(
            wallets.map(async (wallet): Promise<WalletResult> => {
                try {
                    const [holdings, defi] = await Promise.all([getHoldings(wallet), getDefiPositions(wallet)]);
                    return { wallet, holdings: dropDefiDuplicateTokens(holdings, defi), defi };
                } catch (e) {
                    return { wallet, error: (e as Error).message };
                }
            }),
        );

        let totalTokens = 0, defiDeposits = 0, defiBorrows = 0;
        const allTokens: unknown[] = [];
        const allDefiPositions: unknown[] = [];
        const walletSummaries: unknown[] = [];

        for (const p of portfolios) {
            if (p.error || !p.holdings || !p.defi) continue;
            const walletShort = `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`;

            totalTokens += p.holdings.totalValue || 0;
            defiDeposits += p.defi.totalDeposits;
            defiBorrows += p.defi.totalBorrows;

            for (const t of p.holdings.tokens) allTokens.push({ ...t, wallet: p.wallet, walletShort });
            for (const d of p.defi.positions) allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });

            const netWorth = (p.holdings.totalValue || 0) + p.defi.totalDeposits - p.defi.totalBorrows;
            walletSummaries.push({
                wallet: p.wallet,
                summary: {
                    totalNetWorth: netWorth,
                    totalAssets: (p.holdings.totalValue || 0) + p.defi.totalDeposits,
                    totalTokens: p.holdings.totalValue || 0,
                    defiDeposits: p.defi.totalDeposits,
                    defiBorrows: p.defi.totalBorrows,
                },
                tokens: p.holdings.tokens,
                defiPositions: p.defi.positions,
            });
        }

        const totalNetWorth = totalTokens + defiDeposits - defiBorrows;

        res.json({
            wallets,
            aggregate: {
                totalNetWorth,
                totalAssets: totalTokens + defiDeposits,
                totalTokens, defiDeposits, defiBorrows,
                totalPnL: 0,
            },
            tokens: (allTokens as Array<{ value: number }>).sort((a, b) => b.value - a.value),
            defiPositions: (allDefiPositions as Array<{ value: number }>).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
            portfolios: walletSummaries,
        });
    } catch (error) {
        console.error('Aggregate error:', error);
        res.status(500).json({ error: 'Failed to aggregate portfolios' });
    }
});

router.get('/fast/:wallet', async (req: Request<WalletParam>, res: Response): Promise<void> => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        metrics.requests.total++;
        const [rawHoldings, defi] = await Promise.all([getHoldings(wallet), getDefiPositionsFast(wallet)]);
        const holdings = dropDefiDuplicateTokens(rawHoldings, defi);
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

router.post('/aggregate/fast', async (req: Request<unknown, unknown, WalletsBody>, res: Response): Promise<void> => {
    try {
        const inputWallets = req.body?.wallets;
        if (!inputWallets?.length) { res.status(400).json({ error: 'wallets array required' }); return; }

        metrics.requests.total++;
        const wallets = await Promise.all(inputWallets.map((w) => resolveSNS(w)));
        wallets.forEach((w) => metrics.uniqueWallets.add(w));

        const portfolios = await Promise.all(
            wallets.map(async (wallet): Promise<WalletResult> => {
                try {
                    const [holdings, defi] = await Promise.all([getHoldings(wallet), getDefiPositionsFast(wallet)]);
                    return { wallet, holdings: dropDefiDuplicateTokens(holdings, defi), defi };
                } catch (e) {
                    return { wallet, error: (e as Error).message };
                }
            }),
        );

        let totalTokens = 0, defiDeposits = 0, defiBorrows = 0;
        const allTokens: unknown[] = [];
        const allDefiPositions: unknown[] = [];

        for (const p of portfolios) {
            if (p.error || !p.holdings || !p.defi) continue;
            const walletShort = `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`;
            totalTokens += p.holdings.totalValue || 0;
            defiDeposits += p.defi.totalDeposits;
            defiBorrows += p.defi.totalBorrows;
            for (const t of p.holdings.tokens) allTokens.push({ ...t, wallet: p.wallet, walletShort });
            for (const d of p.defi.positions) allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });
        }

        const totalNetWorth = totalTokens + defiDeposits - defiBorrows;

        res.json({
            wallet: 'aggregate',
            aggregate: {
                totalNetWorth,
                totalAssets: totalTokens + defiDeposits,
                totalTokens, defiDeposits, defiBorrows,
            },
            tokens: (allTokens as Array<{ value: number }>).sort((a, b) => b.value - a.value),
            defiPositions: (allDefiPositions as Array<{ value: number }>).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        });
    } catch (error) {
        console.error('Fast aggregate error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

router.post('/trade-pnl', async (req: Request<unknown, unknown, WalletsBody>, res: Response): Promise<void> => {
    try {
        const inputWallets = req.body?.wallets;
        if (!inputWallets?.length) { res.status(400).json({ error: 'wallets array required' }); return; }

        metrics.requests.total++;
        const wallets = await Promise.all(inputWallets.map((w) => resolveSNS(w)));
        const emptyDefi: DefiSummary = { positions: [], totalDeposits: 0, totalBorrows: 0 };
        const [rawHoldings, defis] = await Promise.all([
            Promise.all(wallets.map((w) => getHoldings(w))),
            Promise.all(wallets.map((w) => getDefiPositionsFast(w).catch(() => emptyDefi))),
        ]);
        const holdings = rawHoldings.map((h, i) => dropDefiDuplicateTokens(h, defis[i]!));
        const netWorth = holdings.reduce((s, h) => s + (h.totalValue || 0), 0)
            + defis.reduce((s, d) => s + d.totalDeposits - d.totalBorrows, 0);
        const result = await getAggregateTradePnL(wallets, holdings, netWorth);
        res.json(result);
    } catch (error) {
        if (error instanceof HeliusAuthError) {
            res.status(503).json({
                error: 'Helius API key invalid',
                detail: 'Set HELIUS_API_KEY in the server environment to a valid key.',
            });
            return;
        }
        console.error('Trade P&L error:', error);
        res.status(500).json({ error: 'Failed to compute trade P&L' });
    }
});

type PnlBody = { wallets?: string[]; tokens?: Array<{ address: string; wallet: string }> };

router.post('/pnl', async (req: Request<unknown, unknown, PnlBody>, res: Response): Promise<void> => {
    try {
        const { wallets, tokens } = req.body || {};
        metrics.requests.total++;

        let tokenList: Array<{ address: string; wallet: string }> = [];
        if (wallets?.length) {
            const resolvedWallets = await Promise.all(wallets.map((w) => resolveSNS(w)));
            const holdingsResults = await Promise.all(
                resolvedWallets.map(async (wallet) => {
                    try {
                        const holdings = await getHoldings(wallet);
                        return holdings.tokens.map((t) => ({ address: t.address, wallet }));
                    } catch {
                        return [];
                    }
                }),
            );
            tokenList = holdingsResults.flat();
        } else if (tokens?.length) {
            tokenList = tokens;
        }

        if (!tokenList.length) { res.json({ totalPnL: 0, tokenPnLs: [] }); return; }

        const pnlResults = await Promise.all(
            tokenList.map(async ({ address, wallet }) => {
                const pnl = await getTokenPnL(address, wallet);
                return pnl ? { ...pnl, address, wallet } : null;
            }),
        );

        const validPnLs = pnlResults.filter((p): p is NonNullable<typeof p> => p !== null);
        const totalPnL = validPnLs.reduce((sum, p: TokenPnL) => sum + (p.totalPnL || 0), 0);

        res.json({ totalPnL, tokenPnLs: validPnLs });
    } catch (error) {
        console.error('PnL error:', error);
        res.status(500).json({ error: 'Failed to fetch P&L' });
    }
});

router.post('/dialect', async (req: Request<unknown, unknown, WalletsBody>, res: Response): Promise<void> => {
    try {
        const wallets = req.body?.wallets;
        if (!wallets?.length) { res.json({ positions: [] }); return; }

        metrics.requests.total++;
        const allPositions: unknown[] = [];
        for (const wallet of wallets) {
            const [dialectPos, lambdaPos] = await Promise.all([
                getDialectPositions(wallet),
                getLambdaPositions(wallet),
            ]);
            const positions = filterStaleDialect(dialectPos, lambdaPos);
            const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
            for (const p of positions) allPositions.push({ ...p, wallet, walletShort });
        }

        res.json({ positions: allPositions });
    } catch (error) {
        console.error('Dialect error:', error);
        res.status(500).json({ error: 'Failed to fetch Dialect positions' });
    }
});

router.get('/history/:wallet', async (req: Request<WalletParam>, res: Response): Promise<void> => {
    try {
        const wallet = await resolveSNS(req.params.wallet);
        const days = parseInt(String(req.query.days || ''), 10) || 7;
        const history = await getPortfolioHistory(wallet, days);
        res.json({ wallet, history });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

export default router;
