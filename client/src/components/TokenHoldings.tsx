import { useMemo, useState } from 'react';
import type { DefiPosition, MintCost, TokenHolding, TradePnLRow } from '@shared/types.ts';
import { fmtNum, fmtPct, fmtUsd } from '../lib/format.ts';
import { SortableHeader, type SortDir } from './SortableHeader.tsx';
import { DonutChart } from './DonutChart.tsx';

type TokenRow = TokenHolding & { wallet: string; walletShort: string };

type Sort =
    | 'wallet'
    | 'token'
    | 'balance'
    | 'price'
    | 'value'
    | 'costBasis'
    | 'pnl'
    | 'pnlPercent';

// Stablecoin mints: treat as P&L = 0, cost basis = value.
const STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
]);

type Merged = TokenRow & {
    hasTrade: boolean;
    costBasis: number | null;
    pnl: number | null;
    pnlPercent: number | null;
    avgCost: number | null;
    costSource: string | null;
};

function mergeTokens(tokens: TokenRow[], perWallet: Record<string, TradePnLRow[]>): Merged[] {
    const byKey = new Map<string, TradePnLRow>();
    for (const [walletAddr, rows] of Object.entries(perWallet)) {
        for (const r of rows) byKey.set(`${walletAddr}:${r.mint}`, r);
    }
    return tokens.map((t): Merged => {
        const tr = byKey.get(`${t.wallet}:${t.address}`);
        if (tr) {
            return {
                ...t,
                hasTrade: true,
                costBasis: tr.costBasis,
                pnl: tr.pnl,
                pnlPercent: tr.pnlPercent,
                avgCost: tr.avgCostPerToken,
                costSource: tr.costSource,
            };
        }
        if (STABLECOIN_MINTS.has(t.address)) {
            return {
                ...t,
                hasTrade: true,
                costBasis: t.value || 0,
                pnl: 0,
                pnlPercent: 0,
                avgCost: 1,
                costSource: 'stable',
            };
        }
        return { ...t, hasTrade: false, costBasis: null, pnl: null, pnlPercent: null, avgCost: null, costSource: null };
    });
}

type GroupedRow = Merged & { walletCount: number; missingBasis: boolean };

function groupByMint(rows: Merged[], defiPositions: DefiPosition[], avgBySymbol: Map<string, number>): Merged[] {
    const byMint = new Map<string, GroupedRow>();
    for (const r of rows) {
        let g = byMint.get(r.address);
        if (!g) {
            g = { ...r, walletCount: 0, missingBasis: false };
            g.costBasis = null;
            g.pnl = null;
            g.hasTrade = false;
            g.costSource = null;
            byMint.set(r.address, g);
        } else {
            g.balance = (g.balance || 0) + (r.balance || 0);
            g.value = (g.value || 0) + (r.value || 0);
        }
        g.walletCount += 1;
        if (r.hasTrade) {
            g.hasTrade = true;
            g.costBasis = (g.costBasis || 0) + (r.costBasis || 0);
            g.pnl = (g.pnl || 0) + (r.pnl || 0);
            for (const src of (r.costSource || '').split('+')) {
                if (src && !(g.costSource || '').includes(src)) {
                    g.costSource = g.costSource ? `${g.costSource}+${src}` : src;
                }
            }
        } else {
            g.missingBasis = true;
        }
    }

    const bySymbol = new Map<string, GroupedRow>();
    for (const g of byMint.values()) {
        if (g.symbol) bySymbol.set(g.symbol.toLowerCase(), g);
    }
    for (const d of defiPositions) {
        if (d.type !== 'deposit' || !((d.value || 0) > 0)) continue;
        const sym = (d.token || '').toLowerCase();
        if (!sym) continue;
        let g = bySymbol.get(sym);
        if (g && (g.balance || 0) > 0 && Math.abs(g.balance - (d.amount || 0)) / g.balance < 0.01) continue;
        if (!g) {
            g = {
                address: `defi:${sym}`,
                symbol: d.token,
                name: d.token,
                balance: 0,
                price: (d.amount || 0) > 0 ? d.value / d.amount : 0,
                value: 0,
                icon: d.tokenIcon,
                wallet: '',
                walletShort: 'DeFi',
                hasTrade: false,
                costBasis: null,
                pnl: null,
                pnlPercent: null,
                avgCost: null,
                costSource: null,
                walletCount: 1,
                missingBasis: false,
            };
            byMint.set(g.address, g);
            bySymbol.set(sym, g);
        }
        const avg = g.costBasis != null && (g.balance || 0) > 0 ? g.costBasis / g.balance : (avgBySymbol.get(sym) ?? null);
        g.balance = (g.balance || 0) + (d.amount || 0);
        g.value = (g.value || 0) + (d.value || 0);
        if (avg != null && (d.amount || 0) > 0) {
            g.costBasis = (g.costBasis || 0) + avg * d.amount;
            g.pnl = (g.pnl || 0) + (d.value - avg * d.amount);
            if (!(g.costSource || '').includes('defi')) {
                g.costSource = g.costSource ? `${g.costSource}+defi` : 'defi';
            }
        } else {
            g.missingBasis = true;
        }
    }

    const out: Merged[] = [];
    for (const g of byMint.values()) {
        g.walletShort = g.walletCount > 1 ? `×${g.walletCount}` : g.walletShort;
        g.pnlPercent = g.costBasis && g.costBasis > 0 ? ((g.pnl || 0) / g.costBasis) * 100 : null;
        g.avgCost = g.costBasis != null && (g.balance || 0) > 0 ? g.costBasis / g.balance : null;
        if (g.hasTrade && g.missingBasis) g.costSource = `${g.costSource || ''}+partial`;
        out.push(g);
    }
    return out;
}

export function TokenHoldings({
    tokens,
    perWallet,
    showWalletCol,
    defiPositions = [],
    mintCosts = [],
}: {
    tokens: TokenRow[];
    perWallet: Record<string, TradePnLRow[]>;
    showWalletCol: boolean;
    defiPositions?: DefiPosition[];
    mintCosts?: MintCost[];
}) {
    const [col, setCol] = useState<Sort>('value');
    const [dir, setDir] = useState<SortDir>('desc');
    const [page, setPage] = useState(0);
    const [grouped, setGrouped] = useState(false);
    const PAGE_SIZE = 10;
    const isGrouped = grouped && showWalletCol;

    const merged = useMemo(() => mergeTokens(tokens, perWallet), [tokens, perWallet]);
    const avgBySymbol = useMemo(() => {
        const m = new Map<string, number>();
        for (const c of mintCosts) {
            if (c.symbol && c.avgCostPerToken > 0) m.set(c.symbol.toLowerCase(), c.avgCostPerToken);
        }
        return m;
    }, [mintCosts]);
    const displayRows = useMemo(
        () => (isGrouped ? groupByMint(merged, defiPositions, avgBySymbol) : merged),
        [merged, isGrouped, defiPositions, avgBySymbol],
    );

    const segments = useMemo(() => {
        if (!isGrouped) return [];
        const byValue = [...displayRows].sort((a, b) => (b.value || 0) - (a.value || 0));
        const top = byValue.slice(0, 7).map((t) => ({ label: t.symbol || '?', value: t.value || 0 }));
        const rest = byValue.slice(7).reduce((s, t) => s + (t.value || 0), 0);
        if (rest > 0) top.push({ label: 'Other', value: rest });
        return top;
    }, [displayRows, isGrouped]);
    const tokenTotal = useMemo(() => displayRows.reduce((s, t) => s + (t.value || 0), 0), [displayRows]);

    const sorted = useMemo(() => {
        const sign = dir === 'asc' ? 1 : -1;
        const arr = [...displayRows];
        const nullsLast = (a: number | null, b: number | null) => {
            if (a == null && b == null) return 0;
            if (a == null) return 1;
            if (b == null) return -1;
            return sign * (a - b);
        };
        arr.sort((a, b) => {
            switch (col) {
                case 'wallet':
                    return sign * (a.walletShort || '').localeCompare(b.walletShort || '');
                case 'token':
                    return sign * (a.symbol || '').localeCompare(b.symbol || '');
                case 'balance':
                    return sign * ((a.balance || 0) - (b.balance || 0));
                case 'price':
                    return sign * ((a.price || 0) - (b.price || 0));
                case 'value':
                    return sign * ((a.value || 0) - (b.value || 0));
                case 'costBasis':
                    return nullsLast(a.costBasis, b.costBasis);
                case 'pnl':
                    return nullsLast(a.pnl, b.pnl);
                case 'pnlPercent':
                    return nullsLast(a.pnlPercent, b.pnlPercent);
            }
        });
        return arr;
    }, [displayRows, col, dir]);

    const sortClick = (c: Sort) => {
        if (c === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setCol(c);
            setDir('desc');
        }
        setPage(0);
    };

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    return (
        <section className="rounded-xl border border-border bg-bg-secondary">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-sm font-semibold text-accent">Token Holdings</span>
                {showWalletCol && (
                    <button
                        type="button"
                        onClick={() => { setGrouped((g) => !g); setPage(0); }}
                        className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary hover:border-accent/60 hover:text-text-primary"
                    >
                        {isGrouped ? 'Show per wallet' : 'Group by token'}
                    </button>
                )}
            </div>
            {isGrouped && segments.length > 1 && (
                <div className="border-b border-border">
                    <DonutChart segments={segments} total={tokenTotal} title="Token Allocation" className="relative p-4" />
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-bg-tertiary">
                        <tr>
                            {showWalletCol && (
                                <SortableHeader col="wallet" label="Wallet" activeCol={col} dir={dir} onSort={sortClick} />
                            )}
                            <SortableHeader col="token" label="Token" activeCol={col} dir={dir} onSort={sortClick} />
                            <SortableHeader col="balance" label="Balance" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <SortableHeader col="price" label="Price" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <SortableHeader col="value" label="Value" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <SortableHeader col="costBasis" label="Amount Spent" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <SortableHeader col="pnl" label="P&L" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <SortableHeader col="pnlPercent" label="P&L %" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((t, i) => (
                            <Row key={`${t.wallet}:${t.address}:${i}`} t={t} showWalletCol={showWalletCol} />
                        ))}
                        {pageRows.length === 0 && (
                            <tr>
                                <td colSpan={showWalletCol ? 8 : 7} className="px-3 py-6 text-center text-text-secondary">
                                    No tokens
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 border-t border-border px-3 py-2 text-xs">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="rounded px-2 py-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                    >
                        ‹
                    </button>
                    <span className="text-text-secondary">
                        Page {page + 1} of {totalPages} · {sorted.length} tokens
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="rounded px-2 py-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                    >
                        ›
                    </button>
                </div>
            )}
        </section>
    );
}

function Row({ t, showWalletCol }: { t: Merged; showWalletCol: boolean }) {
    const pnlClass = t.pnl == null ? 'text-text-secondary' : t.pnl >= 0 ? 'text-positive' : 'text-negative';
    const sign = t.pnl != null && t.pnl >= 0 ? '+' : '';
    const isEstimated = t.costSource?.includes('transfer') || t.costSource?.includes('partial') || t.costSource?.includes('defi');
    const muted = <span className="text-text-secondary">—</span>;

    return (
        <tr className="border-t border-border hover:bg-bg-tertiary/40">
            {showWalletCol && (
                <td className="px-3 py-2">
                    <span className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] tabular-nums">
                        {t.walletShort}
                    </span>
                </td>
            )}
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {t.icon && <img src={t.icon} alt="" className="h-4 w-4 rounded-full" onError={(e) => ((e.currentTarget.style.display = 'none'))} />}
                    <span className="font-medium">{t.symbol || '?'}</span>
                </div>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtNum(t.balance, 4)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(t.price)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(t.value)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
                {t.hasTrade ? `${isEstimated ? '~' : ''}${fmtUsd(t.costBasis)}` : muted}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums ${pnlClass}`}>
                {t.hasTrade ? `${sign}${fmtUsd(t.pnl)}` : muted}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums ${pnlClass}`}>
                {t.hasTrade ? fmtPct(t.pnlPercent) : muted}
            </td>
        </tr>
    );
}
