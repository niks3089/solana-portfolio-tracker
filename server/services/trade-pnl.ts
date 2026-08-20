import { LRUCache } from 'lru-cache';
import { CONFIG } from '../config.js';
import { fetchJSON } from '../utils/fetch.js';
import type {
    BuyAggregate, CashEvent, Holdings, SellAggregate, TradeHistoryRow,
    TradePnLResult, TradePnLRow, TradePnLSummary,
} from '../types.js';

const HELIUS_API_KEY = CONFIG.HELIUS_API_KEY;

const STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
]);
const SOL_MINT_WRAPPED = 'So11111111111111111111111111111111111111112';

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;

// Helius enhanced tx — only the fields we read. Everything else stays `unknown`.
type RawTokenAmount = { tokenAmount: string; decimals: number };
type TokenSide = { userAccount?: string; mint: string; rawTokenAmount?: RawTokenAmount };
type NativeSide = { account?: string; amount?: string };
type SwapEvent = {
    nativeInput?: NativeSide | null;
    nativeOutput?: NativeSide | null;
    tokenInputs?: TokenSide[];
    tokenOutputs?: TokenSide[];
};
type TokenTransfer = { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number | string };
type NativeTransfer = { fromUserAccount?: string; toUserAccount?: string; amount?: number | string };
type HeliusTx = {
    type?: string;
    timestamp?: number;
    signature?: string;
    source?: string;
    events?: { swap?: SwapEvent };
    tokenTransfers?: TokenTransfer[];
    nativeTransfers?: NativeTransfer[];
};

const txCache = new LRUCache<string, HeliusTx[]>({ max: 1_000, ttl: 60 * 60 * 1000 });
const resultCache = new LRUCache<string, TradePnLResult>({ max: 500, ttl: 5 * 60 * 1000 });
// Positive cache only — misses re-ask. The original "store null on miss" pattern
// doesn't survive lru-cache's stricter generic constraint.
const histPriceCache = new LRUCache<string, number>({ max: 10_000, ttl: 7 * 24 * 60 * 60 * 1000 });

async function getHistoricalPrice(mint: string, unixTs: number): Promise<number | null> {
    if (!unixTs || unixTs <= 0) return null;
    const dayTs = Math.floor(unixTs / 86400) * 86400;
    const key = `${mint}:${dayTs}`;
    const cached = histPriceCache.get(key);
    if (cached !== undefined) return cached;
    try {
        type Resp = { success?: boolean; data?: { value?: number } };
        const data = await fetchJSON<Resp>(
            `https://public-api.birdeye.so/defi/historical_price_unix?address=${mint}&unixtime=${dayTs}`,
            { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } },
        );
        if (data && data.success && typeof data.data?.value === 'number') {
            const price = data.data.value;
            histPriceCache.set(key, price);
            return price;
        }
        return null;
    } catch (e) {
        console.error(`[TRADE-PNL] Birdeye historical price failed for ${mint.slice(0, 4)}...@${dayTs}:`, (e as Error).message);
        return null;
    }
}

export class HeliusAuthError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'HeliusAuthError';
    }
}

type HeliusErrorResp = { error?: { code?: number; message?: string } };

async function fetchTransactions(wallet: string, maxPages = DEFAULT_MAX_PAGES): Promise<HeliusTx[]> {
    const cached = txCache.get(wallet);
    if (cached) return cached;

    const all: HeliusTx[] = [];
    let before: string | null = null;
    for (let i = 0; i < maxPages; i++) {
        const url: string = `https://api.helius.xyz/v0/addresses/${wallet}/transactions`
            + `?api-key=${HELIUS_API_KEY}&limit=${PAGE_SIZE}`
            + (before ? `&before=${before}` : '');
        let page: HeliusTx[] | HeliusErrorResp;
        try {
            page = await fetchJSON(url);
        } catch (e) {
            console.error(`[TRADE-PNL] Helius fetch failed for ${wallet.slice(0, 4)}...:`, (e as Error).message);
            break;
        }
        if (page && !Array.isArray(page) && (page as HeliusErrorResp).error) {
            const errResp = page as HeliusErrorResp;
            const msg = errResp.error?.message || JSON.stringify(errResp.error);
            if (errResp.error?.code === -32401 || /invalid api key/i.test(msg)) {
                throw new HeliusAuthError(msg);
            }
            console.error(`[TRADE-PNL] Helius API error: ${msg}`);
            break;
        }
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        before = page[page.length - 1]!.signature ?? null;
    }
    txCache.set(wallet, all);
    return all;
}

function rawToFloat(rawTokenAmount: RawTokenAmount | undefined): number {
    if (!rawTokenAmount) return 0;
    const raw = parseFloat(rawTokenAmount.tokenAmount);
    const decimals = Number(rawTokenAmount.decimals) || 0;
    if (!Number.isFinite(raw)) return 0;
    return raw / Math.pow(10, decimals);
}

function cashMintUsd(mint: string, amount: number, solPriceUsd: number): number {
    if (STABLECOIN_MINTS.has(mint)) return amount;
    if (mint === SOL_MINT_WRAPPED) return amount * (solPriceUsd || 0);
    return 0;
}

type WalletSwapEvents = {
    buys: Map<string, BuyAggregate>;
    sells: Map<string, SellAggregate>;
    events: CashEvent[];
};

export function aggregateSwapEvents(wallet: string, txs: HeliusTx[], solPriceUsd: number): WalletSwapEvents {
    const buys = new Map<string, BuyAggregate>();
    const sells = new Map<string, SellAggregate>();
    const events: CashEvent[] = [];

    const cashUsd = (mint: string, amt: number) => cashMintUsd(mint, amt, solPriceUsd);

    for (const tx of txs) {
        const swap = tx?.events?.swap || synthesizeSwapFromTransfers(tx, wallet);
        if (!swap) continue;
        const ts = tx.timestamp || 0;
        const signature = tx.signature || null;
        const source = tx.source || null;

        let cashInUsd = 0;
        const tokensOut: Array<{ mint: string; amount: number }> = [];
        let cashOutUsd = 0;
        const tokensIn: Array<{ mint: string; amount: number }> = [];

        if (swap.nativeInput?.account === wallet) {
            const lam = parseFloat(swap.nativeInput.amount || '0') || 0;
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
            const lam = parseFloat(swap.nativeOutput.amount || '0') || 0;
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

        if (tokensIn.length > 0 && cashInUsd > 0) {
            const total = tokensIn.reduce((s, x) => s + x.amount, 0) || 1;
            for (const t of tokensIn) {
                const cost = cashInUsd * (t.amount / total);
                let acc = buys.get(t.mint);
                if (!acc) {
                    acc = { amountBought: 0, totalCostUsd: 0, txCount: 0, firstTs: ts, lastTs: ts };
                    buys.set(t.mint, acc);
                }
                acc.amountBought += t.amount;
                acc.totalCostUsd += cost;
                acc.txCount += 1;
                if (ts && (!acc.firstTs || ts < acc.firstTs)) acc.firstTs = ts;
                if (ts > acc.lastTs) acc.lastTs = ts;
                events.push({ kind: 'buy_swap', mint: t.mint, amount: t.amount, usd: cost, ts, signature, source });
            }
        }
        if (tokensOut.length > 0 && cashOutUsd > 0) {
            const total = tokensOut.reduce((s, x) => s + x.amount, 0) || 1;
            for (const t of tokensOut) {
                const proceeds = cashOutUsd * (t.amount / total);
                let acc = sells.get(t.mint);
                if (!acc) {
                    acc = { amountSold: 0, totalProceedsUsd: 0, txCount: 0, firstTs: ts, lastTs: ts };
                    sells.set(t.mint, acc);
                }
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

type Cashflow = { ts: number; amount: number };

export function computeXIRR(cashflows: Cashflow[]): number | null {
    if (!cashflows || cashflows.length < 2) return null;
    const cf = [...cashflows].filter((c) => Number.isFinite(c.amount) && Number.isFinite(c.ts));
    cf.sort((a, b) => a.ts - b.ts);
    if (cf.length < 2) return null;

    let hasPos = false, hasNeg = false;
    for (const c of cf) {
        if (c.amount > 0) hasPos = true;
        else if (c.amount < 0) hasNeg = true;
    }
    if (!hasPos || !hasNeg) return null;

    const t0 = cf[0]!.ts;
    const years = (c: Cashflow) => (c.ts - t0) / (365.25 * 86400);
    const npv = (r: number) => cf.reduce((s, c) => s + c.amount / Math.pow(1 + r, years(c)), 0);
    const dnpv = (r: number) => cf.reduce((s, c) => {
        const y = years(c);
        return s + c.amount * (-y) / Math.pow(1 + r, y + 1);
    }, 0);

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

    let lo = -0.99, hi = 100;
    let fLo = npv(lo);
    const fHi = npv(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
    for (let i = 0; i < 400; i++) {
        const mid = (lo + hi) / 2;
        const f = npv(mid);
        if (!Number.isFinite(f)) return null;
        if (Math.abs(f) < 1e-6) return mid;
        if (f * fLo < 0) hi = mid;
        else { lo = mid; fLo = f; }
    }
    return (lo + hi) / 2;
}

function deriveSolPriceFromHoldings(holdingsList: Holdings[]): number {
    for (const h of holdingsList) {
        const sol = (h.tokens || []).find((t) => t.address === SOL_MINT_WRAPPED || t.symbol === 'SOL');
        if (sol?.price) return sol.price;
    }
    return 0;
}

function isExcludedMint(mint: string): boolean {
    return STABLECOIN_MINTS.has(mint);
}

const TRANSFER_ALLOWED_TX_TYPES = new Set(['TRANSFER', 'SWAP', 'UNKNOWN']);

function synthesizeSwapFromTransfers(tx: HeliusTx, wallet: string): SwapEvent | null {
    if (!tx || tx.type !== 'SWAP') return null;
    if (tx.events?.swap) return null;
    const synth: SwapEvent = { tokenInputs: [], tokenOutputs: [], nativeInput: null, nativeOutput: null };

    for (const tt of (tx.tokenTransfers || [])) {
        const amt = parseFloat(String(tt.tokenAmount ?? 0)) || 0;
        if (amt <= 0 || !tt.mint) continue;
        const fakeRaw: RawTokenAmount = { tokenAmount: String(amt), decimals: 0 };
        if (tt.fromUserAccount === wallet) {
            synth.tokenInputs!.push({ userAccount: wallet, mint: tt.mint, rawTokenAmount: fakeRaw });
        } else if (tt.toUserAccount === wallet) {
            synth.tokenOutputs!.push({ userAccount: wallet, mint: tt.mint, rawTokenAmount: fakeRaw });
        }
    }

    let solOut = 0, solIn = 0;
    for (const nt of (tx.nativeTransfers || [])) {
        const lam = parseFloat(String(nt.amount ?? 0)) || 0;
        if (lam <= 0) continue;
        if (nt.fromUserAccount === wallet) solOut += lam;
        else if (nt.toUserAccount === wallet) solIn += lam;
    }
    const FEE_THRESHOLD_LAMPORTS = 1_000_000;
    if (solOut >= FEE_THRESHOLD_LAMPORTS) synth.nativeInput = { account: wallet, amount: String(solOut) };
    if (solIn >= FEE_THRESHOLD_LAMPORTS) synth.nativeOutput = { account: wallet, amount: String(solIn) };

    const empty = (synth.tokenInputs?.length || 0) === 0 && (synth.tokenOutputs?.length || 0) === 0
        && !synth.nativeInput && !synth.nativeOutput;
    return empty ? null : synth;
}

type MintAcc = {
    totalSpent: number; totalBought: number; totalHeld: number; txCount: number;
    sources: Set<string>;
    symbol?: string; name?: string; icon?: string; price?: number;
};
type WalletMintAcc = { totalSpent: number; totalBought: number; txCount: number; sources: Set<string> };
type TransferEvent = { mint: string; amount: number; ts: number; wallet: string; signature: string | null; fromAccount: string | null };

export async function getAggregateTradePnL(wallets: string[], holdings: Holdings[], netWorthUsd?: number): Promise<TradePnLResult> {
    const cacheKey = [...wallets].sort().join(',');
    const cached = resultCache.get(cacheKey);
    if (cached) return cached;

    const solPriceUsd = deriveSolPriceFromHoldings(holdings);
    const txsPerWallet = await Promise.all(wallets.map((w) => fetchTransactions(w)));
    const householdSet = new Set(wallets);

    const swapEventsPerWallet = txsPerWallet.map((txs, i) => aggregateSwapEvents(wallets[i]!, txs, solPriceUsd));
    const accsPerWallet = swapEventsPerWallet.map((x) => x.buys);

    const byMint = new Map<string, MintAcc>();
    const perWalletByMint = wallets.map(() => new Map<string, WalletMintAcc>());
    let hasUnpriced = false;

    function bumpMint(mint: string, deltaSpent: number, deltaBought: number, deltaTxs: number, source: string): MintAcc {
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
    function bumpWalletMint(i: number, mint: string, deltaSpent: number, deltaBought: number, deltaTxs: number, source: string): WalletMintAcc {
        const wmap = perWalletByMint[i]!;
        let m = wmap.get(mint);
        if (!m) {
            m = { totalSpent: 0, totalBought: 0, txCount: 0, sources: new Set() };
            wmap.set(mint, m);
        }
        m.totalSpent += deltaSpent;
        m.totalBought += deltaBought;
        m.txCount += deltaTxs;
        if (source) m.sources.add(source);
        return m;
    }

    for (let i = 0; i < wallets.length; i++) {
        for (const [mint, entry] of accsPerWallet[i]!.entries()) {
            if (isExcludedMint(mint)) continue;
            if (entry.totalCostUsd <= 0) { hasUnpriced = true; continue; }
            bumpMint(mint, entry.totalCostUsd, entry.amountBought, entry.txCount, 'swap');
            bumpWalletMint(i, mint, entry.totalCostUsd, entry.amountBought, entry.txCount, 'swap');
        }
    }

    const heldMintsPerWallet = wallets.map(() => new Set<string>());
    for (let i = 0; i < wallets.length; i++) {
        for (const t of (holdings[i]?.tokens || [])) {
            if (isExcludedMint(t.address)) continue;
            if ((t.balance || 0) > 0) heldMintsPerWallet[i]!.add(t.address);

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

    const transferEvents: TransferEvent[] = [];
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]!;
        const heldMints = heldMintsPerWallet[i]!;
        for (const tx of txsPerWallet[i]!) {
            if (tx.type && !TRANSFER_ALLOWED_TX_TYPES.has(tx.type)) continue;
            const swap = tx?.events?.swap || synthesizeSwapFromTransfers(tx, w);
            const userIsSwapInput = swap && (
                swap.nativeInput?.account === w ||
                (swap.tokenInputs || []).some((x) => x.userAccount === w)
            );
            if (userIsSwapInput) continue;
            for (const tt of (tx.tokenTransfers || [])) {
                if (tt.toUserAccount !== w) continue;
                const mint = tt.mint;
                if (!mint) continue;
                if (isExcludedMint(mint)) continue;
                if (!heldMints.has(mint)) continue;
                if (tt.fromUserAccount && householdSet.has(tt.fromUserAccount)) continue;
                const amount = parseFloat(String(tt.tokenAmount ?? 0)) || 0;
                if (amount <= 0) continue;
                transferEvents.push({
                    mint, amount,
                    ts: tx.timestamp || 0, wallet: w,
                    signature: tx.signature || null,
                    fromAccount: tt.fromUserAccount || null,
                });
            }
        }
    }

    const uniqueQueries = new Map<string, { mint: string; ts: number }>();
    for (const ev of transferEvents) {
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        if (!day) continue;
        const key = `${ev.mint}:${day}`;
        if (!uniqueQueries.has(key)) uniqueQueries.set(key, { mint: ev.mint, ts: day });
    }
    const priceLookups = await Promise.all(
        Array.from(uniqueQueries.entries()).map(async ([key, q]) => {
            const price = await getHistoricalPrice(q.mint, q.ts);
            return [key, price] as const;
        }),
    );
    const priceMap = new Map<string, number | null>(priceLookups);

    for (const ev of transferEvents) {
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        const price = priceMap.get(`${ev.mint}:${day}`);
        if (!price || price <= 0) continue;
        const cost = ev.amount * price;
        bumpMint(ev.mint, cost, ev.amount, 1, 'transfer');
        const wIdx = wallets.indexOf(ev.wallet);
        if (wIdx !== -1) bumpWalletMint(wIdx, ev.mint, cost, ev.amount, 1, 'transfer');
    }

    const perWallet: Record<string, TradePnLRow[]> = {};
    let totalPnL = 0, totalCostBasis = 0, totalValue = 0;

    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]!;
        const rows: TradePnLRow[] = [];
        for (const t of (holdings[i]?.tokens || [])) {
            if (isExcludedMint(t.address)) continue;
            const bal = t.balance || 0;
            if (bal <= 0) continue;

            const own = perWalletByMint[i]!.get(t.address);
            const hh = byMint.get(t.address);

            let totalSpent: number, totalBought: number, denom: number, sourcesSet: Set<string>, attribution: 'wallet' | 'household';
            if (own && own.totalSpent > 0) {
                totalSpent = own.totalSpent;
                totalBought = own.totalBought;
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
            const currentPrice = t.price || hh?.price || 0;
            const currentValue = bal * currentPrice;
            const amountSpent = bal * perTokenCost;
            const pnl = currentValue - amountSpent;
            const pnlPercent = amountSpent > 0 ? (pnl / amountSpent) * 100 : 0;

            rows.push({
                mint: t.address,
                symbol: t.symbol || hh?.symbol,
                name: t.name || hh?.name,
                icon: t.icon || hh?.icon,
                currentAmount: bal,
                currentPrice,
                currentValue,
                costBasis: amountSpent,
                avgCostPerToken: perTokenCost,
                pnl,
                pnlPercent,
                householdSpent: hh ? hh.totalSpent : null,
                householdBought: hh ? hh.totalBought : null,
                householdHeld: hh ? hh.totalHeld : null,
                txCount: own ? own.txCount : (hh ? hh.txCount : 0),
                costSource: Array.from(sourcesSet).sort().join('+') || 'unknown',
                attribution,
            });

            totalPnL += pnl;
            totalCostBasis += amountSpent;
            totalValue += currentValue;
        }
        perWallet[w] = rows;
    }

    // Summary: external cashflows only (transfers in/out of household), priced in USD.
    type ExternalEvent = { mint: string; amount: number; ts: number; dir: 'in' | 'out' };
    const externalEvents: ExternalEvent[] = [];
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]!;
        for (const tx of txsPerWallet[i]!) {
            if (tx.type && tx.type !== 'TRANSFER') continue;
            const ts = tx.timestamp || 0;
            for (const tt of (tx.tokenTransfers || [])) {
                const amt = parseFloat(String(tt.tokenAmount ?? 0)) || 0;
                if (amt <= 0 || !tt.mint) continue;
                if (tt.toUserAccount === w && tt.fromUserAccount && !householdSet.has(tt.fromUserAccount)) {
                    externalEvents.push({ mint: tt.mint, amount: amt, ts, dir: 'in' });
                } else if (tt.fromUserAccount === w && tt.toUserAccount && !householdSet.has(tt.toUserAccount)) {
                    externalEvents.push({ mint: tt.mint, amount: amt, ts, dir: 'out' });
                }
            }
            for (const nt of (tx.nativeTransfers || [])) {
                const lam = parseFloat(String(nt.amount ?? 0)) || 0;
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

    const extPriceQueries = new Map<string, { mint: string; ts: number }>();
    for (const ev of externalEvents) {
        if (STABLECOIN_MINTS.has(ev.mint) || !ev.ts) continue;
        const day = Math.floor(ev.ts / 86400) * 86400;
        const key = `${ev.mint}:${day}`;
        if (!extPriceQueries.has(key)) extPriceQueries.set(key, { mint: ev.mint, ts: day });
    }
    const extPriceLookups = await Promise.all(
        Array.from(extPriceQueries.entries()).map(async ([key, q]) => [key, await getHistoricalPrice(q.mint, q.ts)] as const),
    );
    const extPriceMap = new Map<string, number | null>(extPriceLookups);

    const cashflowEvents: Cashflow[] = [];
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

    const investedDisplay = totalCostBasis;
    const investedGross = cashflowEvents.reduce((s, c) => s + (c.amount < 0 ? -c.amount : 0), 0);
    const realizedReceipts = cashflowEvents.reduce((s, c) => s + (c.amount > 0 ? c.amount : 0), 0);
    const absoluteReturnUsd = totalValue - investedDisplay;
    const absoluteReturnPct = investedDisplay > 0 ? (absoluteReturnUsd / investedDisplay) * 100 : null;

    const nowTs = Math.floor(Date.now() / 1000);
    const terminalValue = netWorthUsd ?? totalValue;
    const xirrRate = computeXIRR([...cashflowEvents, { ts: nowTs, amount: terminalValue }]);
    const xirrPct = xirrRate != null ? xirrRate * 100 : null;

    let benchmarkSolXirrPct: number | null = null;
    if (cashflowEvents.length > 0 && solPriceUsd > 0) {
        const solQueries = new Set(cashflowEvents.map((c) => Math.floor(c.ts / 86400) * 86400));
        const solPriceByDay = new Map<number, number>();
        await Promise.all(Array.from(solQueries).map(async (day) => {
            const p = await getHistoricalPrice(SOL_MINT_WRAPPED, day);
            if (p && p > 0) solPriceByDay.set(day, p);
        }));
        let netSol = 0;
        const bcfs: Cashflow[] = [];
        for (const c of cashflowEvents) {
            const day = Math.floor(c.ts / 86400) * 86400;
            const sp = solPriceByDay.get(day) || solPriceUsd;
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

    const summary: TradePnLSummary = {
        currentValue: totalValue,
        investedTotal: investedDisplay,
        investedGross,
        realizedReceipts,
        absoluteReturnUsd,
        absoluteReturnPct,
        xirrPct,
        benchmarkSolXirrPct,
        cashflowCount: cashflowEvents.length,
    };

    const symbolFor = (mint: string): string | null => {
        const m = byMint.get(mint);
        if (m?.symbol) return m.symbol;
        for (const h of holdings) {
            for (const t of (h?.tokens || [])) {
                if (t.address === mint && t.symbol) return t.symbol;
            }
        }
        return null;
    };

    const tradeHistory: TradeHistoryRow[] = [];
    for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]!;
        const walletShort = `${w.slice(0, 4)}...${w.slice(-4)}`;
        for (const ev of swapEventsPerWallet[i]!.events) {
            if (isExcludedMint(ev.mint)) continue;
            if (!ev.usd || ev.usd <= 0) continue;
            tradeHistory.push({
                kind: ev.kind,
                side: ev.kind === 'buy_swap' ? 'buy' : 'sell',
                wallet: w,
                walletShort,
                mint: ev.mint,
                symbol: symbolFor(ev.mint),
                amount: ev.amount,
                usd: ev.usd,
                ts: ev.ts,
                signature: ev.signature,
                source: ev.source,
                fromExternal: false,
            });
        }
    }
    for (const ev of transferEvents) {
        if (isExcludedMint(ev.mint)) continue;
        const day = Math.floor((ev.ts || 0) / 86400) * 86400;
        const price = priceMap.get(`${ev.mint}:${day}`);
        if (!price || price <= 0) continue;
        const usd = ev.amount * price;
        const w = ev.wallet;
        const walletShort = `${w.slice(0, 4)}...${w.slice(-4)}`;
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
    tradeHistory.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const result: TradePnLResult = {
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
