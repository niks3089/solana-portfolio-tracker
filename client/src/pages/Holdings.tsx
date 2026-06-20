import { useQuery } from '@tanstack/react-query';
import type { Holdings as HoldingsT, DefiPosition } from '@shared/types.ts';

type FastResp = HoldingsT & {
    wallet: string;
    totalNetWorth: number;
    defiDeposits: number;
    defiBorrows: number;
    defiPositions: DefiPosition[];
};

async function fetchFast(wallet: string): Promise<FastResp> {
    const res = await fetch(`/api/portfolio/fast/${wallet}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<FastResp>;
}

// Public demo address — toly.sol — so the page renders something useful without
// wallet connect. Replaced by connected-wallet flow in PR-3.
const DEMO_WALLET = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

export function Holdings() {
    const { data, isPending, isError, error } = useQuery({
        queryKey: ['fast', DEMO_WALLET],
        queryFn: () => fetchFast(DEMO_WALLET),
    });

    return (
        <section>
            <h2 className="text-2xl font-semibold">Holdings</h2>
            <p className="mt-1 text-sm text-text-secondary">Demo wallet: {DEMO_WALLET.slice(0, 6)}…{DEMO_WALLET.slice(-4)}</p>

            <div className="mt-6 rounded-xl border border-border bg-bg-secondary p-6">
                {isPending && <div className="text-text-secondary">Loading…</div>}
                {isError && (
                    <div className="text-negative">Error: {(error as Error).message}</div>
                )}
                {data && (
                    <div className="space-y-2">
                        <Stat label="Net Worth" value={`$${data.totalNetWorth.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <Stat label="Tokens" value={`$${data.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <Stat label="DeFi Deposits" value={`$${data.defiDeposits.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <Stat label="DeFi Borrows" value={`$${data.defiBorrows.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <div className="mt-4 text-xs text-text-secondary">
                            {data.tokens.length} tokens, {data.defiPositions.length} DeFi positions
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">{label}</span>
            <span className="text-lg font-medium tabular-nums">{value}</span>
        </div>
    );
}
