export type PortfolioWallet = { address: string; name?: string };
export type Portfolio = {
    id: number;
    name: string;
    color: string;
    wallets: PortfolioWallet[];
    created_at: string;
};

function key(connectedWallet: string): string {
    return `labels:${connectedWallet}`;
}

export function readPortfolios(connectedWallet: string | null): Portfolio[] {
    if (!connectedWallet) return [];
    try {
        const raw = localStorage.getItem(key(connectedWallet));
        return raw ? (JSON.parse(raw) as Portfolio[]) : [];
    } catch {
        return [];
    }
}

export function writePortfolios(connectedWallet: string, portfolios: Portfolio[]): void {
    try {
        localStorage.setItem(key(connectedWallet), JSON.stringify(portfolios));
    } catch (e) {
        console.error('Failed to persist portfolios:', e);
    }
}

export function nextPortfolioId(portfolios: Portfolio[]): number {
    return portfolios.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
}

// Tracker snapshots: one net-worth point per (portfolio, day).
export function snapshotsKey(connectedWallet: string, labelId: number): string {
    return `snapshots:${connectedWallet}:${labelId}`;
}

export function readSnapshots(connectedWallet: string | null, labelId: number): Record<string, number> {
    if (!connectedWallet) return {};
    try {
        const raw = localStorage.getItem(snapshotsKey(connectedWallet, labelId));
        return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
        return {};
    }
}

export function recordSnapshot(connectedWallet: string | null, labelId: number, netWorth: number): void {
    if (!connectedWallet || !Number.isFinite(netWorth) || netWorth <= 0) return;
    const snaps = readSnapshots(connectedWallet, labelId);
    const today = new Date().toISOString().slice(0, 10);
    snaps[today] = netWorth;
    const keep = Object.keys(snaps).sort().slice(-180);
    const trimmed: Record<string, number> = {};
    for (const k of keep) trimmed[k] = snaps[k]!;
    try {
        localStorage.setItem(snapshotsKey(connectedWallet, labelId), JSON.stringify(trimmed));
    } catch {
        // out of space, ignore
    }
}
