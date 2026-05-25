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

const txCache = new LRUCache({ max: 1000, ttl: 5 * 60 * 1000 });

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

/**
 * Public: compute trade-based P&L across one or more wallets.
 *
 * @param wallets   string[]  Solana wallet addresses (already SNS-resolved)
 * @param holdings  Object[]  Pre-fetched holdings objects (from getHoldings) — one per wallet, same order
 * @returns         { trades: [...], solPriceUsd, walletsScanned, hasUnpriced }
 */
export async function getAggregateTradePnL(wallets, holdings) {
    const solPriceUsd = deriveSolPriceFromHoldings(holdings);

    // Fetch tx history per wallet (cached, parallel)
    const txsPerWallet = await Promise.all(wallets.map(w => fetchTransactions(w)));

    // Per-wallet aggregation, then merge by mint across wallets.
    const byMint = new Map();
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        const walletShort = `${w.slice(0, 4)}...${w.slice(-4)}`;
        const acc = aggregateSwaps(w, txsPerWallet[i], solPriceUsd);

        for (const [mint, entry] of acc.entries()) {
            const existing = byMint.get(mint);
            if (existing) {
                existing.amountBought += entry.amountBought;
                existing.totalCostUsd += entry.totalCostUsd;
                existing.txCount += entry.txCount;
                existing.wallets.add(walletShort);
                if (entry.firstTs && (!existing.firstTs || entry.firstTs < existing.firstTs)) {
                    existing.firstTs = entry.firstTs;
                }
                if (entry.lastTs > existing.lastTs) existing.lastTs = entry.lastTs;
            } else {
                byMint.set(mint, {
                    mint,
                    amountBought: entry.amountBought,
                    totalCostUsd: entry.totalCostUsd,
                    txCount: entry.txCount,
                    firstTs: entry.firstTs,
                    lastTs: entry.lastTs,
                    wallets: new Set([walletShort]),
                });
            }
        }
    }

    // Pull current holdings (current price + amount) keyed by mint, aggregated across wallets.
    const currentByMint = new Map();
    for (const h of holdings) {
        for (const t of h.tokens || []) {
            const existing = currentByMint.get(t.address);
            if (existing) {
                existing.balance += t.balance || 0;
                existing.value += t.value || 0;
            } else {
                currentByMint.set(t.address, {
                    symbol: t.symbol,
                    name: t.name,
                    icon: t.icon,
                    balance: t.balance || 0,
                    price: t.price || 0,
                    value: t.value || 0,
                });
            }
        }
    }

    const trades = [];
    let hasUnpriced = false;

    for (const [mint, entry] of byMint.entries()) {
        const current = currentByMint.get(mint);
        if (!current || current.balance <= 0) continue; // only show tokens still held
        // Skip stablecoins and SOL itself — cost-basis P&L is uninformative there.
        if (STABLECOIN_MINTS.has(mint) || mint === SOL_MINT_WRAPPED || mint === SOL_MINT_NATIVE) continue;

        if (entry.totalCostUsd <= 0) {
            hasUnpriced = true;
            continue;
        }

        const avgCostPerToken = entry.totalCostUsd / entry.amountBought;
        const currentAmount = current.balance;
        const currentPrice = current.price;
        const currentValue = currentAmount * currentPrice;
        const costBasis = avgCostPerToken * currentAmount;
        const pnl = currentValue - costBasis;
        const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

        trades.push({
            mint,
            symbol: current.symbol,
            name: current.name,
            icon: current.icon,
            amountBought: entry.amountBought,
            totalCostUsd: entry.totalCostUsd,
            avgCostPerToken,
            currentAmount,
            currentPrice,
            currentValue,
            costBasis,
            pnl,
            pnlPercent,
            txCount: entry.txCount,
            firstTs: entry.firstTs,
            lastTs: entry.lastTs,
            wallets: Array.from(entry.wallets),
        });
    }

    return {
        trades,
        solPriceUsd,
        walletsScanned: wallets.length,
        hasUnpriced,
    };
}
