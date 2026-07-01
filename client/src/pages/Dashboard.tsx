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

    const isEmpty = wallets.length === 0;

    return (
        <div className="flex flex-col gap-6">
            {isEmpty && <EmptyHero />}

            <WalletInput
                trackedWallets={trackedForInput}
                onAdd={tracked.add}
                onRemove={tracked.remove}
            />

            {connectedWallet && (
                <PortfoliosSection
                    portfolios={portfolios}
                    onCreate={() => setModalMode({ kind: 'create' })}
                    onEdit={(id) => setModalMode({ kind: 'edit', id })}
                />
            )}

            {isEmpty ? (
                <EmptyFeatureGrid />
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

function EmptyHero() {
    return (
        <div className="mt-2 flex flex-col items-center text-center">
            <h1 className="text-3xl font-semibold sm:text-4xl">
                Your Solana portfolio, <span className="text-accent">one view</span>
            </h1>
            <p className="mt-3 max-w-2xl text-text-secondary">
                Track any wallet's holdings, DeFi positions, and P&amp;L. Group
                wallets into named portfolios that live encrypted on the server —
                even the operator can't read them.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <UnifiedWalletButton />
                <a
                    href="https://github.com/niks3089/solana-portfolio-tracker"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-text-secondary hover:border-accent/60 hover:text-text-primary"
                >
                    View source →
                </a>
            </div>
        </div>
    );
}

// ponytail: three static cards, no config. Swap for data-driven grid when we
// actually need a fourth or per-network variant.
function EmptyFeatureGrid() {
    const cards: Array<{ color: 'green' | 'purple' | 'blue'; title: string; body: string }> = [
        {
            color: 'green',
            title: 'Multiple wallets',
            body: 'Group any number of wallets into portfolios. Household P&L, unified holdings, one chart.',
        },
        {
            color: 'purple',
            title: 'DeFi + on-chain P&L',
            body: 'Kamino, Drift, Meteora, Exponent positions. Cost basis derived from swap history and transfer-in prices.',
        },
        {
            color: 'blue',
            title: 'Zero-knowledge server',
            body: 'AES-256-GCM in your browser before anything hits the server. Wallet-signature-derived key, never uploaded.',
        },
    ];
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {cards.map((c) => (
                <div
                    key={c.title}
                    className={`rounded-xl border p-5 ${
                        c.color === 'green'
                            ? 'border-green-500/20 bg-green-500/[0.04]'
                            : c.color === 'purple'
                              ? 'border-purple-500/20 bg-purple-500/[0.04]'
                              : 'border-blue-500/20 bg-blue-500/[0.04]'
                    }`}
                >
                    <div
                        className={`text-xs font-semibold uppercase tracking-wider ${
                            c.color === 'green'
                                ? 'text-green-400'
                                : c.color === 'purple'
                                  ? 'text-purple-400'
                                  : 'text-blue-400'
                        }`}
                    >
                        {c.title}
                    </div>
                    <p className="mt-2 text-sm text-text-secondary">{c.body}</p>
                </div>
            ))}
        </div>
    );
}
