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
// Wrapped SOL mint — what Helius emits in swap events and token transfers.
// (The previous version of this file also referenced a "native" SOL constant
// ending in …111 which isn't a real Solana mint; that branch was dead.)
const SOL_MINT_WRAPPED = 'So11111111111111111111111111111111111111112';

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

// Translate an input/output amount in `mint` to a USD value, if `mint` is a
// known cash token (stablecoin or SOL). Returns 0 for unknown tokens.
function cashMintUsd(mint, amount, solPriceUsd) {
    if (STABLECOIN_MINTS.has(mint)) return amount;
    if (mint === SOL_MINT_WRAPPED) return amount * (solPriceUsd || 0);
    return 0;
}

/**
 * Parse swap events for one wallet. Emits, in a single pass:
 *   - `buys`:  Map<mint, {amountBought, totalCostUsd, txCount, firstTs, lastTs}>
 *              (output tokens acquired with SOL/stablecoin input)
 *   - `sells`: Map<mint, {amountSold, totalProceedsUsd, txCount, firstTs, lastTs}>
 *              (input tokens given up for SOL/stablecoin output)
 *   - `events`: chronological [{kind: 'buy_swap'|'sell_swap', mint, amount, usd, ts}]
 *              used for the XIRR cashflow timeline.
 *
 * Token-for-token swaps (no SOL/stablecoin leg) are skipped — we have no USD
 * anchor to price them.
 */
export function aggregateSwapEvents(wallet, txs, solPriceUsd) {
    const buys = new Map();
    const sells = new Map();
    const events = [];

    const cashUsd = (mint, amt) => cashMintUsd(mint, amt, solPriceUsd);

    for (const tx of txs) {
        // Prefer Helius's parsed swap event; if absent on a SWAP-type tx, synth
        // one from the raw transfer arrays so the wallet's actual cash leg is
        // captured as cost instead of being estimated from a historical lookup.
        const swap = tx?.events?.swap || synthesizeSwapFromTransfers(tx, wallet);
        if (!swap) continue;
        const ts = tx.timestamp || 0;
        const signature = tx.signature || null;
        const source = tx.source || null;

        // Split wallet's inputs/outputs into "cash" (SOL/stablecoin) and "tokens" buckets.
        let cashInUsd = 0;          // USD value of cash the wallet GAVE UP
        const tokensOut = [];        // non-cash tokens the wallet GAVE UP   (potential sells)
        let cashOutUsd = 0;          // USD value of cash the wallet RECEIVED
        const tokensIn = [];         // non-cash tokens the wallet RECEIVED  (potential buys)

        if (swap.nativeInput?.account === wallet) {
            const lam = parseFloat(swap.nativeInput.amount) || 0;
            cashInUsd += (lam / 1e9) * (solPriceUsd || 0);
        }
        for (const i of swap.tokenInputs || []) {
            if (i.userAccount !== wallet) continue;
            const amt = rawToFloat(i.rawTokenAmount);
            if (amt <= 0) continue;
            const usd = cashUsd(i.mint, amt);
            if (usd > 0) cashInUsd += usd;
            else tokensOut.push({ mint: i.mint, amount: amt });
        }
        if (swap.nativeOutput?.account === wallet) {
            const lam = parseFloat(swap.nativeOutput.amount) || 0;
            cashOutUsd += (lam / 1e9) * (solPriceUsd || 0);
        }
        for (const o of swap.tokenOutputs || []) {
            if (o.userAccount !== wallet) continue;
            const amt = rawToFloat(o.rawTokenAmount);
            if (amt <= 0) continue;
            const usd = cashUsd(o.mint, amt);
            if (usd > 0) cashOutUsd += usd;
            else tokensIn.push({ mint: o.mint, amount: amt });
        }

        // Buy leg: non-cash tokens received, priced by cash given up.
        if (tokensIn.length > 0 && cashInUsd > 0) {
            const total = tokensIn.reduce((s, x) => s + x.amount, 0) || 1;
            for (const t of tokensIn) {
                const cost = cashInUsd * (t.amount / total);
                let acc = buys.get(t.mint);
                if (!acc) { acc = { amountBought: 0, totalCostUsd: 0, txCount: 0, firstTs: ts, lastTs: ts }; buys.set(t.mint, acc); }
                acc.amountBought += t.amount;
                acc.totalCostUsd += cost;
                acc.txCount += 1;
                if (ts && (!acc.firstTs || ts < acc.firstTs)) acc.firstTs = ts;
                if (ts > acc.lastTs) acc.lastTs = ts;
                events.push({ kind: 'buy_swap', mint: t.mint, amount: t.amount, usd: cost, ts, signature, source });
            }
        }
        // Sell leg: non-cash tokens given up, priced by cash received.
        if (tokensOut.length > 0 && cashOutUsd > 0) {
            const total = tokensOut.reduce((s, x) => s + x.amount, 0) || 1;
            for (const t of tokensOut) {
                const proceeds = cashOutUsd * (t.amount / total);
                let acc = sells.get(t.mint);
                if (!acc) { acc = { amountSold: 0, totalProceedsUsd: 0, txCount: 0, firstTs: ts, lastTs: ts }; sells.set(t.mint, acc); }
                acc.amountSold += t.amount;
                acc.totalProceedsUsd += proceeds;
                acc.txCount += 1;
                if (ts && (!acc.firstTs || ts < acc.firstTs)) acc.firstTs = ts;
                if (ts > acc.lastTs) acc.lastTs = ts;
                events.push({ kind: 'sell_swap', mint: t.mint, amount: t.amount, usd: proceeds, ts, signature, source });
            }
        }
    }

    return { buys, sells, events };
}

// ============================================================================
// XIRR (annualized rate of return for irregular cashflows)
// ============================================================================

/**
 * Compute XIRR from a list of {ts, amount} cashflows. Negative amounts are
 * outflows (money invested), positive are inflows (money returned). Returns
 * the annualized rate as a decimal (e.g. 0.45 = 45%), or null if undefined.
 *
 * Newton-Raphson with bisection fallback. ~200 iter cap.
 */
export function computeXIRR(cashflows) {
    if (!cashflows || cashflows.length < 2) return null;
    const cf = [...cashflows].filter(c => Number.isFinite(c.amount) && Number.isFinite(c.ts));
    cf.sort((a, b) => a.ts - b.ts);
    if (cf.length < 2) return null;

    let hasPos = false, hasNeg = false;
    for (const c of cf) {
        if (c.amount > 0) hasPos = true;
        else if (c.amount < 0) hasNeg = true;
    }
    if (!hasPos || !hasNeg) return null;

    const t0 = cf[0].ts;
    const years = c => (c.ts - t0) / (365.25 * 86400);
    const npv = r => cf.reduce((s, c) => s + c.amount / Math.pow(1 + r, years(c)), 0);
    const dnpv = r => cf.reduce((s, c) => {
        const y = years(c);
        return s + c.amount * (-y) / Math.pow(1 + r, y + 1);
    }, 0);

    // Newton-Raphson
    let r = 0.1;
    for (let i = 0; i < 200; i++) {
        const f = npv(r);
        if (Math.abs(f) < 1e-6) return r;
        const df = dnpv(r);
        if (!Number.isFinite(df) || Math.abs(df) < 1e-12) break;
        let next = r - f / df;
        if (!Number.isFinite(next)) break;
        if (next <= -0.999) next = -0.99;
        if (Math.abs(next - r) < 1e-9) return next;
        r = next;
    }
    // Bisection fallback over a wide range
    let lo = -0.99, hi = 100;
    let fLo = npv(lo);
    let fHi = npv(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
    for (let i = 0; i < 400; i++) {
        const mid = (lo + hi) / 2;
        const f = npv(mid);
        if (!Number.isFinite(f)) return null;
        if (Math.abs(f) < 1e-6) return mid;
        if (f * fLo < 0) { hi = mid; fHi = f; }
        else { lo = mid; fLo = f; }
    }
    return (lo + hi) / 2;
}

function deriveSolPriceFromHoldings(holdingsList) {
    for (const h of holdingsList) {
        const sol = (h.tokens || []).find(t =>
            t.address === SOL_MINT_WRAPPED || t.symbol === 'SOL'
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

// Helius tx types that can legitimately represent tokens crossing the wallet
// boundary as a real buy/sell or external deposit/withdrawal. DeFi-internal
// types (WITHDRAW, DEPOSIT, BORROW, REPAY, HARVEST_REWARD, REFRESH_OBLIGATION,
// STAKE_SOL, UNSTAKE_SOL, …) are deliberately excluded — those token movements
// are the user's own funds rotating in/out of a protocol, not real trades.
const TRANSFER_ALLOWED_TX_TYPES = new Set(['TRANSFER', 'SWAP', 'UNKNOWN']);

// When Helius types a tx as SWAP but doesn't populate events.swap (happens with
// some routers like Titan), synthesize a minimal swap structure from the raw
// tokenTransfers/nativeTransfers so the existing parser can extract the
// wallet's actual cash leg as cost. Filters to transfers where the wallet is
// directly the from/to account — ignores intermediate router hops.
function synthesizeSwapFromTransfers(tx, wallet) {
    if (!tx || tx.type !== 'SWAP') return null;
    if (tx.events?.swap) return null;
    const synth = { tokenInputs: [], tokenOutputs: [], nativeInput: null, nativeOutput: null };

    for (const tt of (tx.tokenTransfers || [])) {
        const amt = parseFloat(tt.tokenAmount) || 0;
        if (amt <= 0 || !tt.mint) continue;
        // tokenTransfers expose decimal-adjusted tokenAmount; rawTokenAmount in
        // events.swap is raw lots. Fake decimals=0 so rawToFloat returns amt unchanged.
        const fakeRaw = { tokenAmount: String(amt), decimals: 0 };
        if (tt.fromUserAccount === wallet) {
            synth.tokenInputs.push({ userAccount: wallet, mint: tt.mint, rawTokenAmount: fakeRaw });
        } else if (tt.toUserAccount === wallet) {
            synth.tokenOutputs.push({ userAccount: wallet, mint: tt.mint, rawTokenAmount: fakeRaw });
        }
    }

    let solOut = 0;
    let solIn = 0;
    for (const nt of (tx.nativeTransfers || [])) {
        const lam = parseFloat(nt.amount) || 0;
        if (lam <= 0) continue;
        if (nt.fromUserAccount === wallet) solOut += lam;
        else if (nt.toUserAccount === wallet) solIn += lam;
    }
    // Skip tiny SOL legs (< 0.001 SOL); they're almost always tx fees / rent, not the actual swap leg.
    const FEE_THRESHOLD_LAMPORTS = 1_000_000;
    if (solOut >= FEE_THRESHOLD_LAMPORTS) synth.nativeInput = { account: wallet, amount: String(solOut) };
    if (solIn >= FEE_THRESHOLD_LAMPORTS) synth.nativeOutput = { account: wallet, amount: String(solIn) };

    const empty = synth.tokenInputs.length === 0 && synth.tokenOutputs.length === 0
        && !synth.nativeInput && !synth.nativeOutput;
    return empty ? null : synth;
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

    // Pass 1: parse swaps per wallet (extracting buys, sells, and event timeline).
    const swapEventsPerWallet = txsPerWallet.map((txs, i) => aggregateSwapEvents(wallets[i], txs, solPriceUsd));
    const accsPerWallet = swapEventsPerWallet.map(x => x.buys); // back-compat with existing byMint logic

    // Pass 2: build BOTH per-wallet aggregates (preferred) and a household-wide
    // aggregate (fallback for tokens received via intra-household transfer).
    //   byMint:           mint -> { totalSpent, totalBought, totalHeld, txCount, sources: Set }
    //   perWalletByMint:  walletIndex -> Map<mint, {same shape}>  (no totalHeld here)
    const byMint = new Map();
    const perWalletByMint = wallets.map(() => new Map());
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
    function bumpWalletMint(i, mint, deltaSpent, deltaBought, deltaTxs, source) {
        let m = perWalletByMint[i].get(mint);
        if (!m) {
            m = { totalSpent: 0, totalBought: 0, txCount: 0, sources: new Set() };
            perWalletByMint[i].set(mint, m);
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
            bumpWalletMint(i, mint, entry.totalCostUsd, entry.amountBought, entry.txCount, 'swap');
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
            // Allowlist of Helius tx types that can legitimately represent a
            // wallet receiving tokens from outside the household:
            //   TRANSFER  — direct wallet-to-wallet move (CEX withdrawal, send)
            //   SWAP      — a DEX swap; some routers (Titan, etc.) get classified
            //               here but Helius doesn't always populate events.swap,
            //               so the inflow leg shows only as a tokenTransfer.
            //   UNKNOWN   — Helius couldn't classify; still represents a real
            //               token movement worth counting.
            // Everything else (WITHDRAW, DEPOSIT, BORROW, REPAY, STAKE_SOL,
            // HARVEST_REWARD, REFRESH_OBLIGATION, …) is a DeFi protocol
            // interaction where tokens crossing the wallet boundary are the
            // user's own funds rotating in/out of a protocol — not a buy.
            if (tx.type && !TRANSFER_ALLOWED_TX_TYPES.has(tx.type)) continue;
            // If aggregateSwapEvents would already book this as a buy_swap
            // (either via Helius's events.swap or via the synth fallback for
            // SWAP-type txs that Helius didn't parse), skip it here to avoid
            // double-counting the same buy as buy_swap + buy_transfer.
            const swap = tx?.events?.swap || synthesizeSwapFromTransfers(tx, w);
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
                transferEvents.push({ mint, amount, ts: tx.timestamp || 0, wallet: w, signature: tx.signature || null, fromAccount: tt.fromUserAccount || null });
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
        const wIdx = wallets.indexOf(ev.wallet);
        if (wIdx !== -1) bumpWalletMint(wIdx, ev.mint, cost, ev.amount, 1, 'transfer');
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
            const bal = t.balance || 0;
            if (bal <= 0) continue;

            // Prefer THIS wallet's own buy history; fall back to household only
            // when the wallet has no on-chain buys or priced transfer-ins of its own
            // (the "I received this token via intra-household transfer" case).
            const own = perWalletByMint[i].get(t.address);
            const hh = byMint.get(t.address);

            let totalSpent, totalBought, denom, sourcesSet, attribution;
            if (own && own.totalSpent > 0) {
                totalSpent = own.totalSpent;
                totalBought = own.totalBought;
                // Wallet-level denom uses this wallet's own balance (caps cost at money actually spent).
                denom = Math.max(own.totalBought, bal);
                sourcesSet = own.sources;
                attribution = 'wallet';
            } else if (hh && hh.totalSpent > 0) {
                totalSpent = hh.totalSpent;
                totalBought = hh.totalBought;
                denom = Math.max(hh.totalBought, hh.totalHeld);
                sourcesSet = hh.sources;
                attribution = 'household';
            } else {
                continue;
            }

            const perTokenCost = denom > 0 ? totalSpent / denom : 0;
            const currentPrice = t.price || (hh && hh.price) || 0;
            const currentValue = bal * currentPrice;
            const amountSpent = bal * perTokenCost;
            const pnl = currentValue - amountSpent;
            const pnlPercent = amountSpent > 0 ? (pnl / amountSpent) * 100 : 0;

            rows.push({
                mint: t.address,
                symbol: t.symbol || (hh && hh.symbol),
                name: t.name || (hh && hh.name),
                icon: t.icon || (hh && hh.icon),
                currentAmount: bal,
                currentPrice,
                currentValue,
                // Field names: keep `costBasis` so the frontend stays compatible;
                // the column header reads "Amount Spent".
                costBasis: amountSpent,
                avgCostPerToken: perTokenCost,
                pnl,
                pnlPercent,
                // Household-level context (still surfaced so tooltips can hint at it).
                householdSpent: hh ? hh.totalSpent : null,
                householdBought: hh ? hh.totalBought : null,
                householdHeld: hh ? hh.totalHeld : null,
                txCount: own ? own.txCount : (hh ? hh.txCount : 0),
                // 'swap' = on-chain priced buys; 'transfer' = estimated from
                // historical price at transfer-in; can be both ('swap+transfer').
                costSource: Array.from(sourcesSet).sort().join('+') || 'unknown',
                attribution,  // 'wallet' (own buys) or 'household' (inherited from siblings)
            });

            totalPnL += pnl;
            totalCostBasis += amountSpent;
            totalValue += currentValue;
        }
        perWallet[w] = rows;
    }

    // ----- Summary: invested total, absolute return, XIRR, SOL benchmark XIRR -----
    // For XIRR to be meaningful, cashflows must be "external only" — money
    // crossing the boundary of the tracked-wallet set. Swap legs that recycle
    // SOL/stablecoin through the household are NOT cashflows (the cash stays
    // in the portfolio). Real cashflows are transfers in/out from non-household
    // wallets, valued at the historical token price on the transfer day.
    const externalEvents = []; // {mint, amount, ts, dir: 'in'|'out'}
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        for (const tx of txsPerWallet[i]) {
            // Same filter as transfer-in cost basis: only plain TRANSFER txs count
            // as external cashflows. DeFi WITHDRAW/DEPOSIT/BORROW/REPAY are
            // intra-portfolio moves, not money entering or leaving the household.
            if (tx.type && tx.type !== 'TRANSFER') continue;
            const ts = tx.timestamp || 0;
            for (const tt of (tx.tokenTransfers || [])) {
                const amt = parseFloat(tt.tokenAmount) || 0;
                if (amt <= 0 || !tt.mint) continue;
                if (tt.toUserAccount === w && tt.fromUserAccount && !householdSet.has(tt.fromUserAccount)) {
                    externalEvents.push({ mint: tt.mint, amount: amt, ts, dir: 'in' });
                } else if (tt.fromUserAccount === w && tt.toUserAccount && !householdSet.has(tt.toUserAccount)) {
                    externalEvents.push({ mint: tt.mint, amount: amt, ts, dir: 'out' });
                }
            }
            for (const nt of (tx.nativeTransfers || [])) {
                const lam = parseFloat(nt.amount) || 0;
                const sol = lam / 1e9;
                if (sol <= 0) continue;
                if (nt.toUserAccount === w && nt.fromUserAccount && !householdSet.has(nt.fromUserAccount)) {
                    externalEvents.push({ mint: SOL_MINT_WRAPPED, amount: sol, ts, dir: 'in' });
                } else if (nt.fromUserAccount === w && nt.toUserAccount && !householdSet.has(nt.toUserAccount)) {
                    externalEvents.push({ mint: SOL_MINT_WRAPPED, amount: sol, ts, dir: 'out' });
                }
            }
        }
    }

    // Price each external event in USD. Stablecoins at face value; SOL and other
    // tokens via Birdeye historical-price-by-day.
    const extPriceQueries = new Map();
    for (const ev of externalEvents) {
        if (STABLECOIN_MINTS.has(ev.mint) || !ev.ts) continue;
        const day = Math.floor(ev.ts / 86400) * 86400;
        const key = `${ev.mint}:${day}`;
        if (!extPriceQueries.has(key)) extPriceQueries.set(key, { mint: ev.mint, ts: day });
    }
    const extPriceLookups = await Promise.all(
        Array.from(extPriceQueries.entries()).map(async ([key, q]) => [key, await getHistoricalPrice(q.mint, q.ts)])
    );
    const extPriceMap = new Map(extPriceLookups);

    const cashflowEvents = [];
    for (const ev of externalEvents) {
        let usd = 0;
        if (STABLECOIN_MINTS.has(ev.mint)) {
            usd = ev.amount;
        } else {
            const day = Math.floor(ev.ts / 86400) * 86400;
            const p = extPriceMap.get(`${ev.mint}:${day}`);
            if (!p || p <= 0) continue;
            usd = ev.amount * p;
        }
        if (usd <= 0) continue;
        cashflowEvents.push({ ts: ev.ts, amount: ev.dir === 'in' ? -usd : usd });
    }

    // Displayed "Invested" matches the per-token Amount Spent column (household-
    // capped current cost basis), so the summary and the table reconcile. Gross
    // cashflow sums are kept around for XIRR + diagnostics, not for the headline
    // Invested number — those would double-count SOL recycled through swaps.
    const investedDisplay = totalCostBasis;
    const investedGross = cashflowEvents.reduce((s, c) => s + (c.amount < 0 ? -c.amount : 0), 0);
    const realizedReceipts = cashflowEvents.reduce((s, c) => s + (c.amount > 0 ? c.amount : 0), 0);
    const absoluteReturnUsd = totalValue - investedDisplay;       // matches sum of per-token P&L
    const absoluteReturnPct = investedDisplay > 0 ? (absoluteReturnUsd / investedDisplay) * 100 : null;

    // XIRR: append a final "today" cashflow equal to current portfolio value.
    const nowTs = Math.floor(Date.now() / 1000);
    const xirrCashflows = [...cashflowEvents, { ts: nowTs, amount: totalValue }];
    const xirrRate = computeXIRR(xirrCashflows);
    const xirrPct = xirrRate != null ? xirrRate * 100 : null;

    // SOL benchmark: replay the same dollar cashflows against SOL at the historical
    // SOL price on each cashflow date; today's value = net SOL accumulated × current SOL price.
    // If a single day's SOL price can't be fetched, fall back to today's SOL price for
    // that cashflow (better than dropping the entire benchmark).
    let benchmarkSolXirrPct = null;
    if (cashflowEvents.length > 0 && solPriceUsd > 0) {
        const solQueries = new Set(cashflowEvents.map(c => Math.floor(c.ts / 86400) * 86400));
        const solPriceByDay = new Map();
        await Promise.all(Array.from(solQueries).map(async day => {
            const p = await getHistoricalPrice(SOL_MINT_WRAPPED, day);
            if (p && p > 0) solPriceByDay.set(day, p);
        }));
        let netSol = 0;
        const bcfs = [];
        for (const c of cashflowEvents) {
            const day = Math.floor(c.ts / 86400) * 86400;
            const sp = solPriceByDay.get(day) || solPriceUsd; // fallback: today's SOL price
            if (sp <= 0) continue;
            netSol += -c.amount / sp;
            bcfs.push(c);
        }
        if (bcfs.length > 0) {
            const benchValueToday = netSol * solPriceUsd;
            const benchXirr = computeXIRR([...bcfs, { ts: nowTs, amount: benchValueToday }]);
            if (benchXirr != null) benchmarkSolXirrPct = benchXirr * 100;
        }
    }

    const summary = {
        currentValue: totalValue,
        investedTotal: investedDisplay,         // headline number, matches table totals
        investedGross,                           // sum of all buy cashflows (incl. recycled SOL)
        realizedReceipts,                        // sum of all sell cashflows
        absoluteReturnUsd,
        absoluteReturnPct,
        xirrPct,
        benchmarkSolXirrPct,
        cashflowCount: cashflowEvents.length,
    };

    // ----- Trade History: flat chronological list of priced events for the UI -----
    // Includes: swap buys/sells (per wallet's own input/output side), and
    // transfer-ins from outside the household (priced at historical day price).
    // Excludes stablecoin/SOL mints since cost-basis P&L doesn't apply to them.
    const symbolFor = (mint) => {
        const m = byMint.get(mint);
        if (m && m.symbol) return m.symbol;
        // Fallback: look across holdings (in case the token isn't in byMint, e.g., a sold-out position).
        for (const h of holdings) {
            for (const t of (h?.tokens || [])) {
                if (t.address === mint && t.symbol) return t.symbol;
            }
        }
        return null;
    };

    const tradeHistory = [];
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i];
        const walletShort = `${w.slice(0,4)}...${w.slice(-4)}`;
        for (const ev of swapEventsPerWallet[i].events) {
            if (isExcludedMint(ev.mint)) continue;
            if (!ev.usd || ev.usd <= 0) continue;
            tradeHistory.push({
                kind: ev.kind,                                      // 'buy_swap' | 'sell_swap'
                side: ev.kind === 'buy_swap' ? 'buy' : 'sell',
                wallet: w,
                walletShort,
                mint: ev.mint,
                symbol: symbolFor(ev.mint),
                amount: ev.amount,
                usd: ev.usd,
                ts: ev.ts,
                signature: ev.signature,
                source: ev.source,                                  // e.g., 'JUPITER'
                fromExternal: false,
            });
        }
    }
    // Transfer-in events with successful price lookups.
    for (const ev of transferEvents) {
        if (isExcludedMint(ev.mint)) continue;
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        const price = priceMap.get(`${ev.mint}:${day}`);
        if (!price || price <= 0) continue;
        const usd = ev.amount * price;
        const w = ev.wallet;
        const walletShort = `${w.slice(0,4)}...${w.slice(-4)}`;
        tradeHistory.push({
            kind: 'buy_transfer',
            side: 'buy',
            wallet: w,
            walletShort,
            mint: ev.mint,
            symbol: symbolFor(ev.mint),
            amount: ev.amount,
            usd,
            ts: ev.ts,
            signature: ev.signature,
            source: 'TRANSFER',
            fromExternal: true,
            fromAccount: ev.fromAccount,
        });
    }
    // Most recent first.
    tradeHistory.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const result = {
        perWallet,
        totals: { totalPnL, totalCostBasis, totalValue },
        summary,
        tradeHistory,
        solPriceUsd,
        walletsScanned: wallets.length,
        hasUnpriced,
    };
    resultCache.set(cacheKey, result);
    return result;
}
