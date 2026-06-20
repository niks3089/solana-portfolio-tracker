import { fmtUsd, fmtPct } from '../lib/format.ts';
import { Priv } from './PrivateContext.tsx';

type Props = {
    netWorth: number | null;
    defiDeposits: number | null;
    allTimePnL: number | null;
    allTimePnLPct: number | null;
    liabilities: number | null;
};

export function StatsRow({ netWorth, defiDeposits, allTimePnL, allTimePnLPct, liabilities }: Props) {
    const pnlClass = allTimePnL == null ? '' : allTimePnL >= 0 ? 'text-positive' : 'text-negative';

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Net Worth" value={fmtUsd(netWorth)} valueClass="text-positive" />
            <Card label="DeFi Deposits" value={fmtUsd(defiDeposits)} valueClass="text-text-primary" />
            <Card
                label="All-Time P&L"
                value={allTimePnL == null ? '—' : `${allTimePnL >= 0 ? '+' : ''}${fmtUsd(allTimePnL)}`}
                sub={allTimePnLPct == null ? undefined : fmtPct(allTimePnLPct)}
                valueClass={pnlClass}
            />
            <Card label="Liabilities" value={fmtUsd(liabilities)} valueClass="text-negative" />
        </div>
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
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="text-xs uppercase tracking-wide text-text-secondary">{label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}><Priv>{value}</Priv></div>
            {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
        </div>
    );
}
