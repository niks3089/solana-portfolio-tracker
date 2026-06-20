/**
 * Portfolio Data Fetching Service
 */

import { CONFIG } from '../config.js';
import { fetchJSON } from '../utils/fetch.js';
import { metrics } from '../metrics.js';
import { holdingsCache, lambdaDefiCache, dialectDefiCache, pnlCache } from '../cache.js';

const NATIVE_SOL = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

// Get token holdings from Birdeye
export async function getHoldings(wallet) {
    const walletShort = `${wallet.slice(0,4)}...${wallet.slice(-4)}`;
    const cached = holdingsCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getHoldings(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getHoldings(${walletShort}) - calling Birdeye`);

    const data = await fetchJSON(
        `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
        { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
    );

    if (!data.data?.items) {
        return { tokens: [], totalValue: 0 };
    }

    const tokens = data.data.items
        .map(t => {
            // Calculate value ourselves - Birdeye's valueUsd can be incorrect
            const calculatedValue = (t.uiAmount || 0) * (t.priceUsd || 0);
            return {
                symbol: t.symbol,
                name: t.name,
                balance: t.uiAmount,
                price: t.priceUsd,
                value: calculatedValue,
                icon: t.logoURI,
                address: t.address === NATIVE_SOL ? WRAPPED_SOL : t.address,
            };
        })
        .filter(t => t.value > 0.01);

    const result = {
        tokens,
        totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
    };

    holdingsCache.set(wallet, result);
    return result;
}

// Get P&L for a token
export async function getTokenPnL(tokenAddress, wallet) {
    const cacheKey = `${wallet}:${tokenAddress}`;
    const walletShort = `${wallet.slice(0,4)}...${wallet.slice(-4)}`;
    const tokenShort = `${tokenAddress.slice(0,4)}...${tokenAddress.slice(-4)}`;

    const cached = pnlCache.get(cacheKey);
    if (cached !== undefined) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getTokenPnL(${tokenShort}, ${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getTokenPnL(${tokenShort}, ${walletShort}) - calling Birdeye`);

    try {
        const data = await fetchJSON(
            `https://public-api.birdeye.so/wallet/v2/pnl/multiple?token_address=${tokenAddress}&wallets=${wallet}`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
        );

        if (!data.data?.data?.[wallet]) {
            pnlCache.set(cacheKey, null);
            return null;
        }

        const d = data.data.data[wallet];
        const result = {
            address: tokenAddress,
            symbol: data.data.token_metadata?.symbol,
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
    } catch (e) {
        return null;
    }
}

// Get DeFi positions from Dialect
export async function getDialectPositions(wallet) {
    const walletShort = `${wallet.slice(0,4)}...${wallet.slice(-4)}`;
    const cached = dialectDefiCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getDialectPositions(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getDialectPositions(${walletShort}) - calling Dialect`);

    try {
        const data = await fetchJSON(
            `https://markets.dial.to/api/v0/positions/owners?walletAddresses=${wallet}`,
            { headers: { 'x-dialect-api-key': CONFIG.DIALECT_API_KEY } }
        );

        if (!data.positions) {
            dialectDefiCache.set(wallet, []);
            return [];
        }

        const stablecoins = ['USDC', 'USDT', 'PYUSD', 'DAI', 'USDH', 'USH', 'UXD'];

        const result = data.positions.map(pos => {
            const amount = pos.amount || 0;
            const symbol = pos.market?.token?.symbol || '';
            let value = pos.amountUsd;
            if (value === null || value === undefined) {
                value = stablecoins.includes(symbol.toUpperCase()) ? amount : 0;
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
        console.error('Dialect error:', e.message);
        return [];
    }
}

// Get DeFi positions from Lambda P2P
export async function getLambdaPositions(wallet) {
    const walletShort = `${wallet.slice(0,4)}...${wallet.slice(-4)}`;
    const cached = lambdaDefiCache.get(wallet);
    if (cached) {
        metrics.cache.hits++;
        console.log(`💾 [CACHE HIT] getLambdaPositions(${walletShort})`);
        return cached;
    }
    metrics.cache.misses++;
    console.log(`📡 [CACHE MISS] getLambdaPositions(${walletShort}) - calling Lambda`);

    try {
        const data = await fetchJSON(
            `https://api.lambda.p2p.org/api/v1/chains/solana/wallets/${wallet}/balances`,
            { headers: { 'Authorization': CONFIG.LAMBDA_P2P_API_KEY } }
        );

        if (!data.data?.assets) {
            lambdaDefiCache.set(wallet, []);
            return [];
        }

        const positions = [];
        for (const asset of data.data.assets) {
            if (asset.type !== 'position') continue;

            const protocol = asset.defi_name || 'Unknown';
            const protocolIcon = asset.defi_icon_url;

            for (const dep of asset.attributes?.deposits || []) {
                positions.push({
                    protocol,
                    protocolIcon,
                    token: dep.token_symbol,
                    tokenIcon: dep.attributes?.icon_url,
                    type: 'deposit',
                    amount: dep.amount || 0,
                    value: dep.value_usd || 0,
                    apy: 0,
                    source: 'lambda',
                });
            }

            for (const loan of asset.attributes?.loans || []) {
                positions.push({
                    protocol,
                    protocolIcon,
                    token: loan.token_symbol,
                    tokenIcon: loan.attributes?.icon_url,
                    type: 'borrow',
                    amount: loan.amount || 0,
                    value: loan.value_usd || 0,
                    apy: 0,
                    source: 'lambda',
                });
            }
        }

        lambdaDefiCache.set(wallet, positions);
        return positions;
    } catch (e) {
        console.error('Lambda P2P error:', e.message);
        return [];
    }
}

// Fast DeFi - Lambda only (~500ms)
export async function getDefiPositionsFast(wallet) {
    const lambdaPos = await getLambdaPositions(wallet);

    let totalDeposits = 0;
    let totalBorrows = 0;
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

// Full DeFi - Lambda + Dialect (slower, includes rewards)
export async function getDefiPositions(wallet) {
    const [dialectPos, lambdaPos] = await Promise.all([
        getDialectPositions(wallet),
        getLambdaPositions(wallet),
    ]);

    const dialectKeys = new Set(
        dialectPos.map(p => `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`)
    );

    const uniqueLambdaPos = lambdaPos.filter(p => {
        const key = `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`;
        return !dialectKeys.has(key);
    });

    const allPositions = [...dialectPos, ...uniqueLambdaPos];

    let totalDeposits = 0;
    let totalBorrows = 0;

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

// Get portfolio history from Birdeye
export async function getPortfolioHistory(wallet, days = 7) {
    try {
        const data = await fetchJSON(
            `https://public-api.birdeye.so/wallet/v2/net-worth?address=${wallet}&count=${days}&direction=back&type=1d`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
        );
        return data.data || [];
    } catch (e) {
        console.error('Portfolio history error:', e.message);
        return [];
    }
}

