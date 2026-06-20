import { fmtPct, fmtUsd } from '../lib/format.ts';
import type { TradePnLSummary } from '@shared/types.ts';
import { Priv } from './PrivateContext.tsx';

type Props = {
    summary: TradePnLSummary | null;
    netWorth: number | null;
};

export function ReturnsRow({ summary, netWorth }: Props) {
    if (!summary) return null;

    const currentValue = netWorth ?? summary.currentValue;
    const trackedPnL = summary.absoluteReturnUsd ?? 0;
    const invested = Math.max(0, currentValue - trackedPnL);
    const pct = invested > 0 ? (trackedPnL / invested) * 100 : null;

    return (
        <section className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-accent">Returns</h3>
                <span className="text-[11px] text-text-secondary">
                    across all tracked wallets · transfer-ins valued at historical price
                </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card label="Current Value" value={fmtUsd(currentValue)} />
                <Card label="Invested" value={fmtUsd(invested)} sub="incl. stables + DeFi at face value" />
                <Card
                    label="Absolute Return"
                    value={`${trackedPnL >= 0 ? '+' : ''}${fmtUsd(trackedPnL)}`}
                    sub={pct != null ? fmtPct(pct) : undefined}
                    valueClass={trackedPnL >= 0 ? 'text-positive' : 'text-negative'}
                />
                <Card
                    label="XIRR"
                    value={fmtPct(summary.xirrPct)}
                    sub="annualized"
                    valueClass={
                        summary.xirrPct == null
                            ? ''
                            : summary.xirrPct >= 0
                                ? 'text-positive'
                                : 'text-negative'
                    }
                />
            </div>
        </section>
    );
}

function Card({
    label,
    value,
    sub,
    valueClass = '',
}: {
    label: string;
    value: string;
    sub?: string;
    valueClass?: string;
}) {
    return (
        <div className="rounded-lg border border-border bg-bg-tertiary p-3">
            <div className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}><Priv>{value}</Priv></div>
            {sub && <div className="mt-0.5 text-[11px] text-text-secondary">{sub}</div>}
        </div>
    );
}
