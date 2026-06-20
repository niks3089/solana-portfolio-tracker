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
import { useTelegramPings } from '../hooks/useTelegramPings.ts';
import type { PortfolioWallet } from '../lib/portfolios.ts';

export function Dashboard() {
    const { publicKey } = useWallet();
    const connectedWallet = publicKey?.toBase58() || null;

    useTelegramPings(connectedWallet);

    const {
        portfolios, active, activeId, setActiveId,
        create, update, remove,
        trackedWallets, addTracked, removeTracked,
        recordSnapshot, snapshotsFor,
        status,
    } = usePortfolios();

    const [modalMode, setModalMode] = useState<{ kind: 'create' } | { kind: 'edit'; id: number } | null>(null);

    // Wallet set: portfolio (if selected) else tracked + connected.
    const wallets = useMemo(() => {
        if (active) return (active.wallets || []).map((w) => w.address);
        const base = new Set<string>();
        if (connectedWallet) base.add(connectedWallet);
        for (const a of trackedWallets) base.add(a);
        return Array.from(base);
    }, [active, trackedWallets, connectedWallet]);
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

    // Record one daily snapshot per active portfolio when net worth lands.
    useEffect(() => {
        if (activeId != null && aggregate?.totalNetWorth) {
            void recordSnapshot(activeId, aggregate.totalNetWorth);
        }
    }, [activeId, aggregate?.totalNetWorth, recordSnapshot]);

    if (!connectedWallet) {
        return (
            <section className="rounded-xl border border-border bg-bg-secondary p-12 text-center">
                <h2 className="text-2xl font-semibold">Connect a wallet</h2>
                <p className="mt-2 text-text-secondary">
                    Your portfolio data is encrypted in your browser before it touches the server.
                    Even the operator can't read your wallet groupings.
                </p>
                <div className="mt-6 inline-block">
                    <UnifiedWalletButton />
                </div>
            </section>
        );
    }

    if (status.kind === 'awaiting-signature') {
        return (
            <section className="rounded-xl border border-border bg-bg-secondary p-12 text-center">
                <h2 className="text-2xl font-semibold">Sign to unlock your vault</h2>
                <p className="mt-2 text-text-secondary">
                    Your wallet will pop up asking to sign a deterministic message. The signature is
                    hashed into an AES-256 key that lives only in this browser tab. The server never
                    sees it.
                </p>
                <p className="mt-3 text-xs text-text-secondary">
                    One signature per browser session.
                </p>
            </section>
        );
    }

    if (status.kind === 'error') {
        return (
            <section className="rounded-xl border border-border bg-bg-secondary p-12 text-center">
                <h2 className="text-2xl font-semibold text-negative">Vault error</h2>
                <p className="mt-2 text-text-secondary">{status.message}</p>
                <p className="mt-2 text-xs text-text-secondary">
                    Try reloading the page. If the issue persists, the encrypted blob may be from a
                    different key version.
                </p>
            </section>
        );
    }

    if (status.kind === 'loading' || status.kind === 'idle') {
        return (
            <section className="rounded-xl border border-border bg-bg-secondary p-12 text-center">
                <p className="text-text-secondary">Loading vault…</p>
            </section>
        );
    }

    const isLoading = agg.isPending || (wallets.length === 0 && portfolios.length === 0);

    return (
        <div className="flex flex-col gap-4">
            <WalletInput
                trackedWallets={active ? [] : trackedWallets.filter((a) => a !== connectedWallet)}
                onAdd={(addr) => { void addTracked(addr); }}
                onRemove={(addr) => { void removeTracked(addr); }}
            />

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
                        Paste a wallet address above, or create a portfolio.
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
                            snapshots={snapshotsFor(active.id)}
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
                    onSave={async (name, color, ws: PortfolioWallet[]) => {
                        if (modalMode.kind === 'edit') {
                            await update(modalMode.id, { name, color, wallets: ws });
                        } else {
                            const created = await create(name, color, ws);
                            setActiveId(created.id);
                        }
                        setModalMode(null);
                    }}
                    onDelete={
                        modalMode.kind === 'edit'
                            ? async () => {
                                await remove(modalMode.id);
                                setModalMode(null);
                            }
                            : undefined
                    }
                />
            )}
        </div>
    );
}
