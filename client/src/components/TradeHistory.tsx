import { useMemo, useState } from 'react';
import type { TradeHistoryRow } from '@shared/types.ts';
import { fmtDate, fmtNum, fmtUsd } from '../lib/format.ts';
import { SortableHeader, type SortDir } from './SortableHeader.tsx';

type Sort = 'date' | 'side' | 'token' | 'usd';

export function TradeHistory({ rows }: { rows: TradeHistoryRow[] }) {
    const [col, setCol] = useState<Sort>('date');
    const [dir, setDir] = useState<SortDir>('desc');
    const [filter, setFilter] = useState('');
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 10;

    const filtered = useMemo(() => {
        if (!filter) return rows;
        const f = filter.toLowerCase();
        return rows.filter((r) => (r.symbol || '').toLowerCase().includes(f) || r.walletShort.toLowerCase().includes(f));
    }, [rows, filter]);

    const sorted = useMemo(() => {
        const sign = dir === 'asc' ? 1 : -1;
        const arr = [...filtered];
        arr.sort((a, b) => {
            switch (col) {
                case 'date':
                    return sign * ((a.ts || 0) - (b.ts || 0));
                case 'side':
                    return sign * (a.side.localeCompare(b.side));
                case 'token':
                    return sign * ((a.symbol || '').localeCompare(b.symbol || ''));
                case 'usd':
                    return sign * ((a.usd || 0) - (b.usd || 0));
            }
        });
        return arr;
    }, [filtered, col, dir]);

    const sortClick = (c: Sort) => {
        if (c === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setCol(c);
            setDir(c === 'date' || c === 'usd' ? 'desc' : 'asc');
        }
        setPage(0);
    };

    if (rows.length === 0) return null;

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    return (
        <section className="rounded-xl border border-border bg-bg-secondary">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-accent">Trade History</h3>
                <input
                    type="text"
                    placeholder="Filter by token (e.g. QQQx, NVDAx)"
                    value={filter}
                    onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(0);
                    }}
                    className="w-56 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs outline-none focus:border-accent"
                />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-bg-tertiary">
                        <tr>
                            <SortableHeader col="date" label="Date" activeCol={col} dir={dir} onSort={sortClick} />
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                                Wallet
                            </th>
                            <SortableHeader col="side" label="Side" activeCol={col} dir={dir} onSort={sortClick} />
                            <SortableHeader col="token" label="Token" activeCol={col} dir={dir} onSort={sortClick} />
                            <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                                Amount
                            </th>
                            <SortableHeader col="usd" label="USD" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                            <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                                Purchase Price
                            </th>
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                                Tx
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((r, i) => {
                            const sideClass = r.side === 'buy' ? 'text-positive' : 'text-negative';
                            const isEstimated = r.kind === 'buy_transfer';
                            const px = r.amount > 0 ? r.usd / r.amount : 0;
                            const sig = r.signature;
                            return (
                                <tr key={`${sig || i}:${i}`} className="border-t border-border hover:bg-bg-tertiary/40">
                                    <td className="px-3 py-2 tabular-nums">{fmtDate(r.ts)}</td>
                                    <td className="px-3 py-2">
                                        <span className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] tabular-nums">
                                            {r.walletShort}
                                        </span>
                                    </td>
                                    <td className={`px-3 py-2 ${sideClass}`}>{r.side}</td>
                                    <td className="px-3 py-2 font-medium">{r.symbol || r.mint.slice(0, 4) + '…'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.amount, 4)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {isEstimated ? '~' : ''}{fmtUsd(r.usd)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {isEstimated ? '~' : ''}{fmtUsd(px)}
                                    </td>
                                    <td className="px-3 py-2">
                                        {sig ? (
                                            <a
                                                href={`https://www.orbmarkets.io/tx/${encodeURIComponent(sig)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-accent hover:underline"
                                            >
                                                {sig.slice(0, 6)}…{sig.slice(-4)} ↗
                                            </a>
                                        ) : (
                                            <span className="text-text-secondary">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {pageRows.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-3 py-6 text-center text-text-secondary">
                                    No trades match this filter.
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
                        Page {page + 1} of {totalPages} · {sorted.length} trades
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
