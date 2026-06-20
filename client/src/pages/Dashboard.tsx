import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

import { StatsRow } from '../components/StatsRow.tsx';
import { ReturnsRow } from '../components/ReturnsRow.tsx';
import { DonutChart } from '../components/DonutChart.tsx';
import { TokenHoldings } from '../components/TokenHoldings.tsx';
import { DefiPositions } from '../components/DefiPositions.tsx';
import { TradeHistory } from '../components/TradeHistory.tsx';
import { TrackerChart } from '../components/TrackerChart.tsx';
import { PortfolioChips } from '../components/PortfolioChips.tsx';
import { PortfolioModal } from '../components/PortfolioModal.tsx';

import { useAggregateFast, useDialectPositions, useTradePnL } from '../hooks/usePortfolioData.ts';
import { usePortfolios } from '../hooks/usePortfolios.ts';
import { useTelegramPings } from '../hooks/useTelegramPings.ts';
import { readSnapshots, recordSnapshot, type PortfolioWallet } from '../lib/portfolios.ts';

export function Dashboard() {
    const { publicKey } = useWallet();
    const connectedWallet = publicKey?.toBase58() || null;

    useTelegramPings(connectedWallet);

    const { portfolios, active, activeId, setActiveId, create, update, remove } = usePortfolios(connectedWallet);
    const [modalMode, setModalMode] = useState<{ kind: 'create' } | { kind: 'edit'; id: number } | null>(null);

    const wallets = useMemo(() => (active?.wallets || []).map((w) => w.address), [active]);
    const showWalletCol = wallets.length > 1;

    const agg = useAggregateFast(wallets);
    const trade = useTradePnL(wallets);
    const dialect = useDialectPositions(wallets);

    // Merge DeFi from aggregate-fast (Lambda) + Dialect, dedup by (protocol,token,type).
    const defiPositions = useMemo(() => {
        const lambda = agg.data?.defiPositions || [];
        const dialectRows = dialect.data?.positions || [];
        const lambdaKeys = new Set(lambda.map((p) => `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`));
        const extraDialect = dialectRows.filter((p) => {
            const k = `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`;
            return !lambdaKeys.has(k);
        });
        return [...lambda, ...extraDialect].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    }, [agg.data, dialect.data]);

    const aggregate = agg.data?.aggregate || null;
    const summary = trade.data?.summary || null;
    const allTimePnL = summary?.absoluteReturnUsd ?? null;
    const allTimePnLPct = summary?.absoluteReturnPct ?? null;

    // Build chart segments + record daily snapshot when net worth lands.
    const segments = useMemo(() => {
        const protocolTotals: Record<string, number> = {};
        let tokenTotal = 0;
        for (const t of agg.data?.tokens || []) tokenTotal += t.value || 0;
        if (tokenTotal > 0) protocolTotals['Tokens'] = tokenTotal;
        for (const p of defiPositions) {
            if (p.type === 'borrow') continue;
            protocolTotals[p.protocol] = (protocolTotals[p.protocol] || 0) + (p.value || 0);
        }
        return Object.entries(protocolTotals)
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6);
    }, [agg.data, defiPositions]);

    useEffect(() => {
        if (connectedWallet && activeId != null && aggregate?.totalNetWorth) {
            recordSnapshot(connectedWallet, activeId, aggregate.totalNetWorth);
        }
    }, [connectedWallet, activeId, aggregate?.totalNetWorth]);

    const snapshots = useMemo(
        () => (connectedWallet && activeId != null ? readSnapshots(connectedWallet, activeId) : {}),
        // re-read after each refetch lands
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [connectedWallet, activeId, aggregate?.totalNetWorth],
    );

    if (!connectedWallet) {
        return (
            <section className="rounded-xl border border-border bg-bg-secondary p-12 text-center">
                <h2 className="text-2xl font-semibold">Connect a wallet</h2>
                <p className="mt-2 text-text-secondary">
                    Group multiple wallets into portfolios and track P&L across them. Nothing is stored server-side.
                </p>
                <div className="mt-6 inline-block">
                    <WalletMultiButton />
                </div>
            </section>
        );
    }

    const isLoading = agg.isPending || (wallets.length === 0 && portfolios.length === 0);

    return (
        <div className="flex flex-col gap-4">
            <PortfolioChips
                portfolios={portfolios}
                activeId={activeId}
                onSelect={(id) => setActiveId(id)}
                onEdit={(id) => setModalMode({ kind: 'edit', id })}
                onCreate={() => setModalMode({ kind: 'create' })}
            />

            {wallets.length === 0 ? (
                <section className="rounded-xl border border-border bg-bg-secondary p-8 text-center">
                    <p className="text-text-secondary">
                        {portfolios.length === 0
                            ? 'Create your first portfolio above to get started.'
                            : 'Select a portfolio above to view its holdings.'}
                    </p>
                </section>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
                        <StatsRow
                            netWorth={aggregate?.totalNetWorth ?? null}
                            defiDeposits={aggregate?.defiDeposits ?? null}
                            allTimePnL={allTimePnL}
                            allTimePnLPct={allTimePnLPct}
                            liabilities={aggregate?.defiBorrows ?? null}
                        />
                        {segments.length > 0 && (
                            <DonutChart segments={segments} total={aggregate?.totalAssets ?? 0} />
                        )}
                    </div>

                    {active && aggregate?.totalNetWorth ? (
                        <TrackerChart
                            snapshots={snapshots}
                            currentNetWorth={aggregate.totalNetWorth}
                            label={active.name}
                        />
                    ) : null}

                    <ReturnsRow summary={summary} netWorth={aggregate?.totalNetWorth ?? null} />

                    {agg.data && (
                        <TokenHoldings
                            tokens={agg.data.tokens}
                            perWallet={trade.data?.perWallet || {}}
                            showWalletCol={showWalletCol}
                        />
                    )}

                    {defiPositions.length > 0 && (
                        <DefiPositions positions={defiPositions} showWalletCol={showWalletCol} />
                    )}

                    {trade.data?.tradeHistory && trade.data.tradeHistory.length > 0 && (
                        <TradeHistory rows={trade.data.tradeHistory} />
                    )}

                    {isLoading && (
                        <p className="text-center text-sm text-text-secondary">Loading portfolio…</p>
                    )}
                    {agg.isError && (
                        <p className="text-center text-sm text-negative">Error: {(agg.error as Error).message}</p>
                    )}
                </>
            )}

            {modalMode && (
                <PortfolioModal
                    mode={
                        modalMode.kind === 'create'
                            ? { kind: 'create' }
                            : { kind: 'edit', portfolio: portfolios.find((p) => p.id === modalMode.id)! }
                    }
                    onClose={() => setModalMode(null)}
                    onSave={(name, color, ws: PortfolioWallet[]) => {
                        if (modalMode.kind === 'edit') {
                            update(modalMode.id, { name, color, wallets: ws });
                        } else {
                            const created = create(name, color, ws);
                            setActiveId(created.id);
                        }
                        setModalMode(null);
                    }}
                    onDelete={
                        modalMode.kind === 'edit'
                            ? () => {
                                remove(modalMode.id);
                                setModalMode(null);
                            }
                            : undefined
                    }
                />
            )}
        </div>
    );
}
