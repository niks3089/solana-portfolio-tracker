import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtUsd } from '../lib/format.ts';

type Snapshot = { date: string; netWorth: number };

export function TrackerChart({ snapshots, currentNetWorth, label }: {
    snapshots: Record<string, number>;
    currentNetWorth: number;
    label: string;
}) {
    const data = useMemo(() => {
        const arr: Snapshot[] = Object.entries(snapshots)
            .map(([date, netWorth]) => ({ date, netWorth }))
            .sort((a, b) => a.date.localeCompare(b.date));
        const today = new Date().toISOString().slice(0, 10);
        if (currentNetWorth > 0 && (!arr.length || arr[arr.length - 1]!.date !== today)) {
            arr.push({ date: today, netWorth: currentNetWorth });
        } else if (arr.length && arr[arr.length - 1]!.date === today) {
            arr[arr.length - 1]!.netWorth = currentNetWorth;
        }
        return arr;
    }, [snapshots, currentNetWorth]);

    if (data.length < 2) return null;

    const peak = Math.max(...data.map((d) => d.netWorth));
    const first = data[0]!.netWorth;
    const last = data[data.length - 1]!.netWorth;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    const isUp = change >= 0;

    return (
        <section className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-accent">{label} tracker</h3>
                <div className="flex gap-4 text-xs text-text-secondary">
                    <span>
                        Peak <span className="text-text-primary tabular-nums">{fmtUsd(peak)}</span>
                    </span>
                    <span>
                        Since Created{' '}
                        <span className={`tabular-nums ${isUp ? 'text-positive' : 'text-negative'}`}>
                            {isUp ? '+' : ''}{fmtUsd(change)} ({changePct.toFixed(1)}%)
                        </span>
                    </span>
                </div>
            </div>
            <div className="h-48 w-full">
                <ResponsiveContainer>
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="tracker" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
                                <stop offset="100%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#26262d" />
                        <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#26262d" tickFormatter={(v) => fmtUsd(v)} width={60} />
                        <Tooltip
                            contentStyle={{
                                background: 'var(--color-bg-tertiary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 8,
                                fontSize: 12,
                            }}
                            formatter={(v) => fmtUsd(Number(v))}
                        />
                        <Area type="monotone" dataKey="netWorth" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={2.5} fill="url(#tracker)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </section>
    );
}
