/**
 * Trade-based P&L from Helius transaction history.
 *
 * For each token currently held, scan the wallet's parsed transactions for
 * swap events where it received that token, sum the USD-denominated cost
 * (SOL or stablecoin inputs only — token-for-token swaps are not priced),
 * and compute cost basis / unrealized P&L against the current Birdeye price.
 *
 * Cost basis is intentionally approximate: SOL inputs are valued at the
 * *current* SOL price, not the historical price at swap time. This is
 * surfaced as a "trade cost basis" view, not realized tax-grade P&L.
 */

import { LRUCache } from 'lru-cache';
import { CONFIG } from '../config.js';
import { fetchJSON } from '../utils/fetch.js';

const HELIUS_API_KEY = CONFIG.HELIUS_API_KEY;

const STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
]);
const SOL_MINT_WRAPPED = 'So11111111111111111111111111111111111111112';
const SOL_MINT_NATIVE = 'So11111111111111111111111111111111111111111';

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5; // up to 500 most recent txs per wallet

// 1-hour cache for raw Helius tx history (Enhanced API is the slow path here).
const txCache = new LRUCache({ max: 1000, ttl: 60 * 60 * 1000 });
// Short cache for the fully-computed per-wallet-list result; prices in the
// result come from holdingsCache (5-min TTL) so a tight TTL here is fine and
// keeps the All-Time P&L number reasonably fresh.
const resultCache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });
// Historical token price cache, keyed by `${mint}:${dayUnixTs}`. Day-resolution
// is plenty for cost-basis estimation and keeps Birdeye call volume bounded.
const histPriceCache = new LRUCache({ max: 10000, ttl: 7 * 24 * 60 * 60 * 1000 });

async function getHistoricalPrice(mint, unixTs) {
    if (!unixTs || unixTs <= 0) return null;
    const dayTs = Math.floor(unixTs / 86400) * 86400;
    const key = `${mint}:${dayTs}`;
    if (histPriceCache.has(key)) return histPriceCache.get(key);
    try {
        const data = await fetchJSON(
            `https://public-api.birdeye.so/defi/historical_price_unix?address=${mint}&unixtime=${dayTs}`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
        );
        const price = (data && data.success && data.data && typeof data.data.value === 'number')
            ? data.data.value : null;
        histPriceCache.set(key, price);
        return price;
    } catch (e) {
        console.error(`[TRADE-PNL] Birdeye historical price failed for ${mint.slice(0,4)}...@${dayTs}:`, e.message);
        histPriceCache.set(key, null);
        return null;
    }
}

class HeliusAuthError extends Error {
    constructor(msg) {
        super(msg);
        this.name = 'HeliusAuthError';
    }
}

async function fetchTransactions(wallet, maxPages = DEFAULT_MAX_PAGES) {
    const cached = txCache.get(wallet);
    if (cached) return cached;

    const all = [];
    let before = null;
    for (let i = 0; i < maxPages; i++) {
        const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions`
            + `?api-key=${HELIUS_API_KEY}&limit=${PAGE_SIZE}`
            + (before ? `&before=${before}` : '');
        let page;
        try {
            page = await fetchJSON(url);
        } catch (e) {
            console.error(`[TRADE-PNL] Helius fetch failed for ${wallet.slice(0,4)}...:`, e.message);
            break;
        }
        // Helius returns {jsonrpc, error: {...}} on auth failure
        if (page && !Array.isArray(page) && page.error) {
            const msg = page.error?.message || JSON.stringify(page.error);
            if (page.error.code === -32401 || /invalid api key/i.test(msg)) {
                throw new HeliusAuthError(msg);
            }
            console.error(`[TRADE-PNL] Helius API error: ${msg}`);
            break;
        }
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        before = page[page.length - 1].signature;
    }
    txCache.set(wallet, all);
    return all;
}

export { HeliusAuthError };

function rawToFloat(rawTokenAmount) {
    if (!rawTokenAmount) return 0;
    const raw = parseFloat(rawTokenAmount.tokenAmount);
    const decimals = parseInt(rawTokenAmount.decimals, 10) || 0;
    if (!Number.isFinite(raw)) return 0;
    return raw / Math.pow(10, decimals);
}

function valueOfInputUsd(mint, amount, solPriceUsd) {
    if (STABLECOIN_MINTS.has(mint)) return amount;
    if (mint === SOL_MINT_WRAPPED || mint === SOL_MINT_NATIVE) {
        return amount * (solPriceUsd || 0);
    }
    return 0; // unknown token cost
}

/**
 * Parse swaps for a single wallet and aggregate cost basis per output mint.
 * Returns Map<mint, { amountBought, totalCostUsd, txCount, firstTs, lastTs }>.
 */
export function aggregateSwaps(wallet, txs, solPriceUsd) {
    const acc = new Map();

    for (const tx of txs) {
        const swap = tx?.events?.swap;
        if (!swap) continue;

        // What did THIS wallet receive in this swap?
        const outputs = (swap.tokenOutputs || []).filter(o => o.userAccount === wallet);
        if (outputs.length === 0) continue;

        // What did this wallet spend? Compute total USD cost from priced inputs.
        let costUsd = 0;

        if (swap.nativeInput?.account === wallet) {
            const lamports = parseFloat(swap.nativeInput.amount) || 0;
            costUsd += (lamports / 1e9) * (solPriceUsd || 0);
        }
        for (const input of swap.tokenInputs || []) {
            if (input.userAccount !== wallet) continue;
            const amt = rawToFloat(input.rawTokenAmount);
            costUsd += valueOfInputUsd(input.mint, amt, solPriceUsd);
        }

        if (costUsd <= 0) continue; // token-for-token w/ no known USD anchor

        // Distribute cost across outputs proportionally by raw amount.
        const outputAmounts = outputs.map(o => rawToFloat(o.rawTokenAmount));
        const totalOut = outputAmounts.reduce((s, x) => s + x, 0);
        if (totalOut <= 0) continue;

        for (let i = 0; i < outputs.length; i++) {
            const out = outputs[i];
            const amt = outputAmounts[i];
            if (amt <= 0) continue;
            const share = amt / totalOut;
            const entry = acc.get(out.mint) || {
                amountBought: 0,
                totalCostUsd: 0,
                txCount: 0,
                firstTs: tx.timestamp || 0,
                lastTs: tx.timestamp || 0,
            };
            entry.amountBought += amt;
            entry.totalCostUsd += costUsd * share;
            entry.txCount += 1;
            if (tx.timestamp) {
                if (!entry.firstTs || tx.timestamp < entry.firstTs) entry.firstTs = tx.timestamp;
                if (tx.timestamp > entry.lastTs) entry.lastTs = tx.timestamp;
            }
            acc.set(out.mint, entry);
        }
    }

    return acc;
}

function deriveSolPriceFromHoldings(holdingsList) {
    for (const h of holdingsList) {
        const sol = (h.tokens || []).find(t =>
            t.address === SOL_MINT_WRAPPED ||
            t.address === SOL_MINT_NATIVE ||
            t.symbol === 'SOL'
        );
        if (sol?.price) return sol.price;
    }
    return 0;
}

// Excluded from cost-basis P&L output:
// - Stablecoins: by definition P&L ≈ 0, surfaced as a special case in the UI.
// SOL is INCLUDED — if the user bought SOL via a USDC/USDT swap, that's a real
// cost basis worth showing.
function isExcludedMint(mint) {
    return STABLECOIN_MINTS.has(mint);
}

/**
 * Public: compute trade-based P&L across one or more wallets, treating the
 * wallet set as one "household" for cost attribution.
 *
 * Why household: a token bought on wallet A and transferred to wallet B should
 * carry A's cost basis onto B. Strict per-wallet attribution shows "—" on B
 * (no swap event), which is technically right but misleading when both
 * wallets belong to the same person.
 *
 * Per-mint algorithm:
 *   totalSpent  = sum of USD spent on priced buys across all wallets
 *   totalBought = sum of token amount received on those buys
 *   totalHeld   = sum of current balance across all wallets
 *   perTokenCost = totalSpent / max(totalBought, totalHeld)
 *     - if totalHeld <= totalBought (sold some): collapses to avgCost
 *     - if totalHeld > totalBought  (transferred in): caps total attribution
 *       at totalSpent (full money out of pocket), distributed pro-rata to
 *       current holders
 * Per (wallet, mint) row:  amountSpent = balance * perTokenCost,  P&L = value - amountSpent.
 *
 * @returns { perWallet, totals, solPriceUsd, walletsScanned, hasUnpriced }
 */
export async function getAggregateTradePnL(wallets, holdings) {
    const cacheKey = [...wallets].sort().join(',');
    const cached = resultCache.get(cacheKey);
    if (cached) return cached;

    const solPriceUsd = deriveSolPriceFromHoldings(holdings);
    const txsPerWallet = await Promise.all(wallets.map(w => fetchTransactions(w)));

    // Set of all addresses in the tracked household — used to skip
    // wallet-to-wallet transfers (those don't add new cost basis).
    const householdSet = new Set(wallets);

    // Pass 1: parse swaps per wallet.
    const accsPerWallet = txsPerWallet.map((txs, i) => aggregateSwaps(wallets[i], txs, solPriceUsd));

    // Pass 2: per-mint household aggregate.
    //   mint -> { totalSpent, totalBought, totalHeld, txCount, sources: Set }
    const byMint = new Map();
    let hasUnpriced = false;

    function bumpMint(mint, deltaSpent, deltaBought, deltaTxs, source) {
        let m = byMint.get(mint);
        if (!m) {
            m = { totalSpent: 0, totalBought: 0, totalHeld: 0, txCount: 0, sources: new Set() };
            byMint.set(mint, m);
        }
        m.totalSpent += deltaSpent;
        m.totalBought += deltaBought;
        m.txCount += deltaTxs;
        if (source) m.sources.add(source);
        return m;
    }

    for (let i = 0; i < wallets.length; i++) {
        for (const [mint, entry] of accsPerWallet[i].entries()) {
            if (isExcludedMint(mint)) continue;
            if (entry.totalCostUsd <= 0) { hasUnpriced = true; continue; }
            bumpMint(mint, entry.totalCostUsd, entry.amountBought, entry.txCount, 'swap');
        }
    }

    // Sum current holdings into byMint AND grab display metadata + price.
    // Also build a per-wallet "currently held mints" set so the transfer-in
    // scanner only looks up prices for tokens we still hold.
    const heldMintsPerWallet = wallets.map(() => new Set());
    for (let i = 0; i < wallets.length; i++) {
        for (const t of (holdings[i]?.tokens || [])) {
            if (isExcludedMint(t.address)) continue;
            if ((t.balance || 0) > 0) heldMintsPerWallet[i].add(t.address);

            // Seed byMint for held tokens even without a swap, so the
            // transfer-in pass below can attach cost to them.
            let m = byMint.get(t.address);
            if (!m) {
                m = { totalSpent: 0, totalBought: 0, totalHeld: 0, txCount: 0, sources: new Set() };
                byMint.set(t.address, m);
            }
            m.totalHeld += t.balance || 0;
            if (!m.symbol) { m.symbol = t.symbol; m.name = t.name; m.icon = t.icon; }
            if (!m.price && t.price) m.price = t.price;
        }
    }

    // Pass 2b: transfer-in fallback. For each tx where the wallet RECEIVED a
    // currently-held mint via a tokenTransfer NOT initiated by a swap that
    // the wallet itself paid for, treat the transfer as a synthetic buy
    // priced at the historical token price on that day.
    // Self-transfers between tracked wallets are skipped (no new cost).
    const transferEvents = []; // {mint, amount, ts, wallet}
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        const heldMints = heldMintsPerWallet[i];
        for (const tx of txsPerWallet[i]) {
            const swap = tx?.events?.swap;
            const userIsSwapInput = swap && (
                swap.nativeInput?.account === w ||
                (swap.tokenInputs || []).some(x => x.userAccount === w)
            );
            if (userIsSwapInput) continue;
            for (const tt of (tx.tokenTransfers || [])) {
                if (tt.toUserAccount !== w) continue;
                const mint = tt.mint;
                if (isExcludedMint(mint)) continue;
                if (!heldMints.has(mint)) continue; // only price what's still held
                if (tt.fromUserAccount && householdSet.has(tt.fromUserAccount)) continue; // intra-household
                const amount = parseFloat(tt.tokenAmount) || 0;
                if (amount <= 0) continue;
                transferEvents.push({ mint, amount, ts: tx.timestamp || 0, wallet: w });
            }
        }
    }

    // Fetch historical prices in parallel (deduped per (mint, day)).
    const uniqueQueries = new Map();
    for (const ev of transferEvents) {
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        if (!day) continue;
        const key = `${ev.mint}:${day}`;
        if (!uniqueQueries.has(key)) uniqueQueries.set(key, { mint: ev.mint, ts: day });
    }
    const priceLookups = await Promise.all(
        Array.from(uniqueQueries.entries()).map(async ([key, q]) => {
            const price = await getHistoricalPrice(q.mint, q.ts);
            return [key, price];
        })
    );
    const priceMap = new Map(priceLookups);

    for (const ev of transferEvents) {
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        const price = priceMap.get(`${ev.mint}:${day}`);
        if (!price || price <= 0) continue;
        const cost = ev.amount * price;
        bumpMint(ev.mint, cost, ev.amount, 1, 'transfer');
    }

    // Pass 3: emit per-(wallet, mint) rows for tokens currently held.
    const perWallet = {};
    let totalPnL = 0;
    let totalCostBasis = 0;
    let totalValue = 0;

    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        const rows = [];
        for (const t of (holdings[i]?.tokens || [])) {
            if (isExcludedMint(t.address)) continue;
            const m = byMint.get(t.address);
            if (!m || m.totalSpent <= 0) continue;
            const bal = t.balance || 0;
            if (bal <= 0) continue;

            const denom = Math.max(m.totalBought, m.totalHeld);
            const perTokenCost = denom > 0 ? m.totalSpent / denom : 0;
            const currentPrice = t.price || m.price || 0;
            const currentValue = bal * currentPrice;
            const amountSpent = bal * perTokenCost;
            const pnl = currentValue - amountSpent;
            const pnlPercent = amountSpent > 0 ? (pnl / amountSpent) * 100 : 0;

            rows.push({
                mint: t.address,
                symbol: t.symbol || m.symbol,
                name: t.name || m.name,
                icon: t.icon || m.icon,
                currentAmount: bal,
                currentPrice,
                currentValue,
                // Field names: keep `costBasis` so the frontend stays compatible;
                // the column header now reads "Amount Spent".
                costBasis: amountSpent,
                avgCostPerToken: perTokenCost,
                pnl,
                pnlPercent,
                // Household-level context (for tooltips):
                householdSpent: m.totalSpent,
                householdBought: m.totalBought,
                householdHeld: m.totalHeld,
                txCount: m.txCount,
                // 'swap' = on-chain priced buys; 'transfer' = estimated from
                // historical price at transfer-in; can be both ('mixed').
                costSource: Array.from(m.sources).sort().join('+') || 'unknown',
            });

            totalPnL += pnl;
            totalCostBasis += amountSpent;
            totalValue += currentValue;
        }
        perWallet[w] = rows;
    }

    const result = {
        perWallet,
        totals: { totalPnL, totalCostBasis, totalValue },
        solPriceUsd,
        walletsScanned: wallets.length,
        hasUnpriced,
    };
    resultCache.set(cacheKey, result);
    return result;
}
