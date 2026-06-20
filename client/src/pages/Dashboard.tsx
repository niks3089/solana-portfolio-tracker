import { useEffect, useMemo, useState } from 'react';
import { UnifiedWalletButton, useWallet } from '@jup-ag/wallet-adapter';

import { StatsRow } from '../components/StatsRow.tsx';
import { ReturnsRow } from '../components/ReturnsRow.tsx';
import { DonutChart } from '../components/DonutChart.tsx';
import { TokenHoldings } from '../components/TokenHoldings.tsx';
import { DefiPositions } from '../components/DefiPositions.tsx';
import { TradeHistory } from '../components/TradeHistory.tsx';
import { TrackerChart } from '../components/TrackerChart.tsx';
import { PortfolioChips } from '../components/PortfolioChips.tsx';
import { PortfolioModal } from '../components/PortfolioModal.tsx';
import { WalletInput } from '../components/WalletInput.tsx';

import { useAggregateFast, useDialectPositions, useTradePnL } from '../hooks/usePortfolioData.ts';
import { usePortfolios } from '../hooks/usePortfolios.ts';
import { useTrackedWallets } from '../hooks/useTrackedWallets.ts';
import { useTelegramPings } from '../hooks/useTelegramPings.ts';
import type { PortfolioWallet } from '../lib/portfolios.ts';

export function Dashboard() {
    const { publicKey } = useWallet();
    const connectedWallet = publicKey?.toBase58() || null;

    useTelegramPings(connectedWallet);

    // Tracked wallets are localStorage-only — anyone can paste a wallet and
    // browse its portfolio without any signature.
    const tracked = useTrackedWallets();

    // Portfolios are vault-backed and require wallet + signature, but only
    // when the user actually opens the portfolios section.
    const portfolios = usePortfolios();

    const [modalMode, setModalMode] = useState<{ kind: 'create' } | { kind: 'edit'; id: number } | null>(null);

    const wallets = useMemo(() => {
        if (portfolios.active) return (portfolios.active.wallets || []).map((w) => w.address);
        const base = new Set<string>();
        if (connectedWallet) base.add(connectedWallet);
        for (const a of tracked.wallets) base.add(a);
        return Array.from(base);
    }, [portfolios.active, tracked.wallets, connectedWallet]);
    const showWalletCol = wallets.length > 1;

    const agg = useAggregateFast(wallets);
    const trade = useTradePnL(wallets);
    const dialect = useDialectPositions(wallets);

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
        if (portfolios.activeId != null && aggregate?.totalNetWorth) {
            void portfolios.recordSnapshot(portfolios.activeId, aggregate.totalNetWorth);
        }
    }, [portfolios.activeId, aggregate?.totalNetWorth, portfolios.recordSnapshot]);

    const trackedForInput = portfolios.active
        ? []
        : tracked.wallets.filter((a) => a !== connectedWallet);

    return (
        <div className="flex flex-col gap-4">
            <WalletInput
                trackedWallets={trackedForInput}
                onAdd={tracked.add}
                onRemove={tracked.remove}
            />

            {connectedWallet ? (
                <PortfoliosSection
                    portfolios={portfolios}
                    onCreate={() => setModalMode({ kind: 'create' })}
                    onEdit={(id) => setModalMode({ kind: 'edit', id })}
                />
            ) : (
                <p className="text-sm text-text-secondary">
                    Connect a wallet to save portfolios across devices. Your data is
                    encrypted in your browser before it touches the server — even the
                    operator can't read it.
                </p>
            )}

            {wallets.length === 0 ? (
                <section className="rounded-xl border border-border bg-bg-secondary p-8 text-center">
                    <p className="text-text-secondary">
                        Paste a wallet address above to start tracking it,
                        or <ConnectInline /> to load saved portfolios.
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

                    {portfolios.active && aggregate?.totalNetWorth ? (
                        <TrackerChart
                            snapshots={portfolios.snapshotsFor(portfolios.active.id)}
                            currentNetWorth={aggregate.totalNetWorth}
                            label={portfolios.active.name}
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

                    {agg.isPending && (
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
                            : { kind: 'edit', portfolio: portfolios.portfolios.find((p) => p.id === modalMode.id)! }
                    }
                    onClose={() => setModalMode(null)}
                    onSave={async (name, color, ws: PortfolioWallet[]) => {
                        if (modalMode.kind === 'edit') {
                            await portfolios.update(modalMode.id, { name, color, wallets: ws });
                        } else {
                            const created = await portfolios.create(name, color, ws);
                            portfolios.setActiveId(created.id);
                        }
                        setModalMode(null);
                    }}
                    onDelete={
                        modalMode.kind === 'edit'
                            ? async () => {
                                await portfolios.remove(modalMode.id);
                                setModalMode(null);
                            }
                            : undefined
                    }
                />
            )}
        </div>
    );
}

function PortfoliosSection({
    portfolios,
    onCreate,
    onEdit,
}: {
    portfolios: ReturnType<typeof usePortfolios>;
    onCreate: () => void;
    onEdit: (id: number) => void;
}) {
    const { status, unlock } = portfolios;

    if (status.kind === 'locked') {
        return (
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-secondary">Portfolios are encrypted.</span>
                <button
                    type="button"
                    onClick={() => { void unlock(); }}
                    className="rounded-md border border-border bg-bg-tertiary px-3 py-1.5 hover:border-accent/60"
                >
                    Sign to unlock
                </button>
            </div>
        );
    }
    if (status.kind === 'awaiting-signature' || status.kind === 'loading') {
        return <p className="text-sm text-text-secondary">Unlocking portfolios…</p>;
    }
    if (status.kind === 'error') {
        return (
            <p className="text-sm text-negative">
                Vault error: {status.message}.{' '}
                <button
                    type="button"
                    onClick={() => { void unlock(); }}
                    className="underline hover:text-text-primary"
                >
                    Retry
                </button>
            </p>
        );
    }

    return (
        <PortfolioChips
            portfolios={portfolios.portfolios}
            activeId={portfolios.activeId}
            onSelect={(id) => portfolios.setActiveId(id)}
            onEdit={onEdit}
            onCreate={onCreate}
        />
    );
}

function ConnectInline() {
    return (
        <span className="inline-flex">
            <UnifiedWalletButton />
        </span>
    );
}
