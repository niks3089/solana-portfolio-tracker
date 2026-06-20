import { useMemo, useState } from 'react';
import type { DefiPosition } from '@shared/types.ts';
import { fmtNum, fmtUsd } from '../lib/format.ts';
import { SortableHeader, type SortDir } from './SortableHeader.tsx';

type Row = DefiPosition & { wallet: string; walletShort: string };

type Sort = 'wallet' | 'protocol' | 'type' | 'asset' | 'value';

export function DefiPositions({ positions, showWalletCol }: { positions: Row[]; showWalletCol: boolean }) {
    const [col, setCol] = useState<Sort>('value');
    const [dir, setDir] = useState<SortDir>('desc');
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 10;

    const sorted = useMemo(() => {
        const sign = dir === 'asc' ? 1 : -1;
        const arr = [...positions];
        arr.sort((a, b) => {
            switch (col) {
                case 'wallet':
                    return sign * (a.walletShort || '').localeCompare(b.walletShort || '');
                case 'protocol':
                    return sign * (a.protocol || '').localeCompare(b.protocol || '');
                case 'type':
                    return sign * (a.type || '').localeCompare(b.type || '');
                case 'asset':
                    return sign * (a.token || '').localeCompare(b.token || '');
                case 'value': {
                    const av = a.type === 'borrow' ? -(a.value || 0) : a.value || 0;
                    const bv = b.type === 'borrow' ? -(b.value || 0) : b.value || 0;
                    return sign * (av - bv);
                }
            }
        });
        return arr;
    }, [positions, col, dir]);

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
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-accent">DeFi Positions</div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-bg-tertiary">
                        <tr>
                            {showWalletCol && (
                                <SortableHeader col="wallet" label="Wallet" activeCol={col} dir={dir} onSort={sortClick} />
                            )}
                            <SortableHeader col="protocol" label="Protocol" activeCol={col} dir={dir} onSort={sortClick} />
                            <SortableHeader col="type" label="Type" activeCol={col} dir={dir} onSort={sortClick} />
                            <SortableHeader col="asset" label="Asset" activeCol={col} dir={dir} onSort={sortClick} />
                            <SortableHeader col="value" label="Value" activeCol={col} dir={dir} onSort={sortClick} align="right" />
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((p, i) => {
                            const isBorrow = p.type === 'borrow';
                            return (
                                <tr key={`${p.wallet}:${p.protocol}:${p.token}:${p.type}:${i}`} className="border-t border-border hover:bg-bg-tertiary/40">
                                    {showWalletCol && (
                                        <td className="px-3 py-2">
                                            <span className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] tabular-nums">
                                                {p.walletShort}
                                            </span>
                                        </td>
                                    )}
                                    <td className="px-3 py-2">{p.protocol || '?'}</td>
                                    <td className="px-3 py-2">
                                        <span
                                            className={[
                                                'rounded-md px-1.5 py-0.5 text-[11px]',
                                                isBorrow
                                                    ? 'border border-negative/40 text-negative'
                                                    : 'border border-accent/40 text-accent',
                                            ].join(' ')}
                                        >
                                            {p.type}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        {p.token || '?'} <span className="text-[11px] text-text-secondary">{fmtNum(p.amount, 2)}</span>
                                    </td>
                                    <td className={`px-3 py-2 text-right tabular-nums ${isBorrow ? 'text-negative' : ''}`}>
                                        {isBorrow ? '-' : ''}{fmtUsd(p.value)}
                                    </td>
                                </tr>
                            );
                        })}
                        {pageRows.length === 0 && (
                            <tr>
                                <td colSpan={showWalletCol ? 5 : 4} className="px-3 py-6 text-center text-text-secondary">
                                    No DeFi positions
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
                        Page {page + 1} of {totalPages} · {sorted.length} positions
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
