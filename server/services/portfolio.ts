import { CONFIG } from '../config.js';
import { fetchJSON } from '../utils/fetch.js';
import { metrics } from '../metrics.js';
import { holdingsCache, lambdaDefiCache, dialectDefiCache, pnlCache } from '../cache.js';
import type {
    DefiPosition, DefiSummary, Holdings, TokenHolding, TokenPnL,
} from '../types.js';

const NATIVE_SOL = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

type BirdeyeHoldingsResp = {
    data?: {
        items?: Array<{
            symbol?: string;
            name?: string;
            uiAmount?: number;
            priceUsd?: number;
            logoURI?: string;
            address: string;
        }>;
    };
};

export async function getHoldings(wallet: string): Promise<Holdings> {
    const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    const cached = holdingsCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getHoldings(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getHoldings(${walletShort}) - calling Birdeye`);

    const data = await fetchJSON<BirdeyeHoldingsResp>(
        `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
        { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } },
    );

    if (!data.data?.items) return { tokens: [], totalValue: 0 };

    const tokens: TokenHolding[] = data.data.items
        .map((t) => ({
            symbol: t.symbol,
            name: t.name,
            balance: t.uiAmount || 0,
            price: t.priceUsd || 0,
            value: (t.uiAmount || 0) * (t.priceUsd || 0),
            icon: t.logoURI,
            address: t.address === NATIVE_SOL ? WRAPPED_SOL : t.address,
        }))
        .filter((t) => t.value > 0.01);

    const result: Holdings = {
        tokens,
        totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
    };

    holdingsCache.set(wallet, result);
    return result;
}

type BirdeyePnLResp = {
    data?: {
        token_metadata?: { symbol?: string };
        data?: Record<string, {
            cashflow_usd?: { total_invested?: number; current_value?: number };
            pnl?: { realized_profit_usd?: number; unrealized_usd?: number; total_usd?: number; total_percent?: number };
            pricing?: { avg_buy_cost?: number };
        }>;
    };
};

export async function getTokenPnL(tokenAddress: string, wallet: string): Promise<TokenPnL | null> {
    const cacheKey = `${wallet}:${tokenAddress}`;
    const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    const tokenShort = `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`;

    const hit = pnlCache.get(cacheKey);
    if (hit !== undefined) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getTokenPnL(${tokenShort}, ${walletShort})`);
        return hit;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getTokenPnL(${tokenShort}, ${walletShort}) - calling Birdeye`);

    try {
        const data = await fetchJSON<BirdeyePnLResp>(
            `https://public-api.birdeye.so/wallet/v2/pnl/multiple?token_address=${tokenAddress}&wallets=${wallet}`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } },
        );

        const d = data.data?.data?.[wallet];
        if (!d) {
            // Don't store nulls — `undefined` from .get() means "ask again". For
            // negative caching we'd need a wrapper; current behavior just re-asks.
            return null;
        }

        const result: TokenPnL = {
            address: tokenAddress,
            symbol: data.data?.token_metadata?.symbol,
            invested: d.cashflow_usd?.total_invested || 0,
            currentValue: d.cashflow_usd?.current_value || 0,
            realizedPnL: d.pnl?.realized_profit_usd || 0,
            unrealizedPnL: d.pnl?.unrealized_usd || 0,
            totalPnL: d.pnl?.total_usd || 0,
            totalPnLPercent: (d.pnl?.total_percent || 0) * 100,
            avgBuyPrice: d.pricing?.avg_buy_cost || 0,
        };

        pnlCache.set(cacheKey, result);
        return result;
    } catch {
        return null;
    }
}

type DialectPositionsResp = {
    positions?: Array<{
        amount?: number;
        amountUsd?: number | null;
        side?: string;
        type?: string;
        market?: {
            token?: { symbol?: string; icon?: string };
            provider?: { name?: string; icon?: string };
            depositApy?: number;
            borrowApy?: number;
        };
    }>;
};

const STABLECOINS = new Set(['USDC', 'USDT', 'PYUSD', 'DAI', 'USDH', 'USH', 'UXD']);

export async function getDialectPositions(wallet: string): Promise<DefiPosition[]> {
    const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    const cached = dialectDefiCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getDialectPositions(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getDialectPositions(${walletShort}) - calling Dialect`);

    try {
        const data = await fetchJSON<DialectPositionsResp>(
            `https://markets.dial.to/api/v0/positions/owners?walletAddresses=${wallet}`,
            { headers: { 'x-dialect-api-key': CONFIG.DIALECT_API_KEY } },
        );

        if (!data.positions) {
            dialectDefiCache.set(wallet, []);
            return [];
        }

        const result: DefiPosition[] = data.positions.map((pos) => {
            const amount = pos.amount || 0;
            const symbol = pos.market?.token?.symbol || '';
            let value: number;
            if (pos.amountUsd == null) {
                value = STABLECOINS.has(symbol.toUpperCase()) ? amount : 0;
            } else {
                value = pos.amountUsd;
            }
            return {
                protocol: pos.market?.provider?.name || 'Unknown',
                protocolIcon: pos.market?.provider?.icon,
                token: symbol,
                tokenIcon: pos.market?.token?.icon,
                type: pos.side || pos.type || 'deposit',
                amount,
                value,
                apy: (pos.market?.depositApy || pos.market?.borrowApy || 0) * 100,
                source: 'dialect',
            };
        });

        dialectDefiCache.set(wallet, result);
        return result;
    } catch (e) {
        console.error('Dialect error:', (e as Error).message);
        return [];
    }
}

type LambdaPositionsResp = {
    data?: {
        assets?: Array<{
            type?: string;
            defi_name?: string;
            defi_icon_url?: string;
            attributes?: {
                deposits?: Array<{ token_symbol?: string; amount?: number; value_usd?: number; attributes?: { icon_url?: string } }>;
                loans?: Array<{ token_symbol?: string; amount?: number; value_usd?: number; attributes?: { icon_url?: string } }>;
            };
        }>;
    };
};

export async function getLambdaPositions(wallet: string): Promise<DefiPosition[]> {
    const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    const cached = lambdaDefiCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getLambdaPositions(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getLambdaPositions(${walletShort}) - calling Lambda`);

    try {
        const data = await fetchJSON<LambdaPositionsResp>(
            `https://api.lambda.p2p.org/api/v1/chains/solana/wallets/${wallet}/balances`,
            { headers: { Authorization: CONFIG.LAMBDA_P2P_API_KEY } },
        );

        const positions: DefiPosition[] = [];
        for (const asset of data.data?.assets || []) {
            if (asset.type !== 'position') continue;
            const protocol = asset.defi_name || 'Unknown';
            const protocolIcon = asset.defi_icon_url;

            for (const dep of asset.attributes?.deposits || []) {
                positions.push({
                    protocol, protocolIcon,
                    token: dep.token_symbol, tokenIcon: dep.attributes?.icon_url,
                    type: 'deposit', amount: dep.amount || 0, value: dep.value_usd || 0,
                    apy: 0, source: 'lambda',
                });
            }
            for (const loan of asset.attributes?.loans || []) {
                positions.push({
                    protocol, protocolIcon,
                    token: loan.token_symbol, tokenIcon: loan.attributes?.icon_url,
                    type: 'borrow', amount: loan.amount || 0, value: loan.value_usd || 0,
                    apy: 0, source: 'lambda',
                });
            }
        }

        lambdaDefiCache.set(wallet, positions);
        return positions;
    } catch (e) {
        console.error('Lambda P2P error:', (e as Error).message);
        return [];
    }
}

const WALLET_HELD_POSITION_PROTOCOLS = new Set(['exponent']);

export function dropDefiDuplicateTokens(holdings: Holdings, defi: DefiSummary): Holdings {
    const tokens = holdings.tokens.filter((t) => {
        if (!t.symbol || !(t.balance > 0)) return true;
        const sym = t.symbol.toLowerCase();
        const isDupe = defi.positions.some((p) =>
            p.type === 'deposit'
            && (WALLET_HELD_POSITION_PROTOCOLS.has(p.protocol.toLowerCase()) || sym.startsWith('pt-'))
            && (p.token || '').toLowerCase() === sym
            && p.amount > 0
            && Math.abs(p.amount - t.balance) / t.balance < 0.01);
        if (isDupe) console.log(`[DEDUPE] dropping wallet token ${t.symbol} (${t.balance}) — matches DeFi deposit`);
        return !isDupe;
    });
    if (tokens.length === holdings.tokens.length) return holdings;
    return { tokens, totalValue: tokens.reduce((s, t) => s + t.value, 0) };
}

export async function getDefiPositionsFast(wallet: string): Promise<DefiSummary> {
    const lambdaPos = await getLambdaPositions(wallet);
    let totalDeposits = 0, totalBorrows = 0;
    for (const pos of lambdaPos) {
        if (pos.type === 'borrow') totalBorrows += pos.value;
        else totalDeposits += pos.value;
    }
    return {
        positions: lambdaPos.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        totalDeposits,
        totalBorrows,
    };
}

export async function getDefiPositions(wallet: string): Promise<DefiSummary> {
    const [dialectPos, lambdaPos] = await Promise.all([
        getDialectPositions(wallet),
        getLambdaPositions(wallet),
    ]);

    const dialectKeys = new Set(
        dialectPos.map((p) => `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`),
    );

    const uniqueLambdaPos = lambdaPos.filter((p) => {
        const key = `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`;
        return !dialectKeys.has(key);
    });

    const allPositions = [...dialectPos, ...uniqueLambdaPos];

    let totalDeposits = 0, totalBorrows = 0;
    for (const pos of allPositions) {
        if (pos.type === 'borrow') totalBorrows += pos.value;
        else totalDeposits += pos.value;
    }

    return {
        positions: allPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        totalDeposits,
        totalBorrows,
    };
}

type HistoryResp = { data?: unknown };

export async function getPortfolioHistory(wallet: string, days = 7): Promise<unknown> {
    try {
        const data = await fetchJSON<HistoryResp>(
            `https://public-api.birdeye.so/wallet/v2/net-worth?address=${wallet}&count=${days}&direction=back&type=1d`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } },
        );
        return data.data || [];
    } catch (e) {
        console.error('Portfolio history error:', (e as Error).message);
        return [];
    }
}
