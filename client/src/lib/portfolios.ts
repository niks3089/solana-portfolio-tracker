export type PortfolioWallet = { address: string; name?: string };
export type Portfolio = {
    id: number;
    name: string;
    color: string;
    wallets: PortfolioWallet[];
    created_at: string;
};

// Vault payload shape — single encrypted JSON object on the server.
// Snapshots live here too so they sync across devices, not just per browser.
export type VaultPayload = {
    portfolios: Portfolio[];
    // snapshots: portfolioId → { "YYYY-MM-DD": netWorth }
    snapshots: Record<string, Record<string, number>>;
    // ephemeral tracked wallets (separate from portfolios)
    trackedWallets: string[];
};

export const EMPTY_VAULT: VaultPayload = {
    portfolios: [],
    snapshots: {},
    trackedWallets: [],
};

export function nextPortfolioId(portfolios: Portfolio[]): number {
    return portfolios.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
}

export function recordSnapshotInPayload(
    payload: VaultPayload,
    labelId: number,
    netWorth: number,
): VaultPayload {
    if (!Number.isFinite(netWorth) || netWorth <= 0) return payload;
    const today = new Date().toISOString().slice(0, 10);
    const prev = payload.snapshots[String(labelId)] || {};
    // No change → skip rewrite (avoids vault churn on every render).
    if (prev[today] != null && Math.abs(prev[today] - netWorth) / Math.max(1, netWorth) < 0.0001) {
        return payload;
    }
    const next = { ...prev, [today]: netWorth };
    // Keep last 180 days max.
    const keys = Object.keys(next).sort();
    const trimmed: Record<string, number> = {};
    for (const k of keys.slice(-180)) trimmed[k] = next[k]!;
    return {
        ...payload,
        snapshots: { ...payload.snapshots, [String(labelId)]: trimmed },
    };
}
