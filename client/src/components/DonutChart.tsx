import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { fmtUsd } from '../lib/format.ts';

type Segment = { label: string; value: number };

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'];

export function DonutChart({ segments, total }: { segments: Segment[]; total: number }) {
    const filtered = segments.filter((s) => s.value > 0);

    return (
        <div className="relative rounded-xl border border-border bg-bg-secondary p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-text-secondary">Total Value Locked</div>
            <div className="relative h-48 w-full">
                <ResponsiveContainer>
                    <PieChart>
                        <Pie
                            data={filtered}
                            dataKey="value"
                            innerRadius="60%"
                            outerRadius="90%"
                            paddingAngle={2}
                            stroke="none"
                        >
                            {filtered.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                background: 'var(--color-bg-tertiary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 8,
                                fontSize: 12,
                            }}
                            formatter={(v) => fmtUsd(Number(v))}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-xl font-semibold">{fmtUsd(total)}</div>
                    <div className="text-[11px] uppercase tracking-wide text-text-secondary">Total</div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {filtered.slice(0, 8).map((s, i) => (
                    <span key={s.label} className="flex items-center gap-1.5">
                        <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: COLORS[i % COLORS.length] }}
                        />
                        {s.label}
                    </span>
                ))}
            </div>
        </div>
    );
}
