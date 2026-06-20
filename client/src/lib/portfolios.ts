export type PortfolioWallet = { address: string; name?: string };
export type Portfolio = {
    id: number;
    name: string;
    color: string;
    wallets: PortfolioWallet[];
    created_at: string;
};

// Vault payload shape — single encrypted JSON object on the server.
// Only personal data that's worth syncing across devices lives here.
// Tracked wallets are NOT in the vault — they're per-browser ephemeral
// browsing state, stored in localStorage and visible without any wallet
// connection.
export type VaultPayload = {
    portfolios: Portfolio[];
    snapshots: Record<string, Record<string, number>>;
};

export const EMPTY_VAULT: VaultPayload = {
    portfolios: [],
    snapshots: {},
};

export function nextPortfolioId(portfolios: Portfolio[]): number {
    return portfolios.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
}

// --- Tracked wallets (per-browser, no auth required) ---
const TRACKED_WALLETS_KEY = 'trackedWallets';

export function readTrackedWallets(): string[] {
    try {
        const raw = localStorage.getItem(TRACKED_WALLETS_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
}

export function writeTrackedWallets(wallets: string[]): void {
    try {
        localStorage.setItem(TRACKED_WALLETS_KEY, JSON.stringify(wallets));
    } catch { /* quota — ignore */ }
}

// --- Legacy migration readers ---
// Kept so the first vault load for a given wallet can migrate pre-vault data
// (the original keys used by the localStorage-only build, before any server-
// side encrypted vault existed). Legacy entries are NOT deleted after
// migration; they stay as a local backup until the user clears browser data.
export function readLegacyPortfolios(wallet: string): Portfolio[] {
    try {
        const raw = localStorage.getItem(`labels:${wallet}`);
        return raw ? (JSON.parse(raw) as Portfolio[]) : [];
    } catch { return []; }
}

export function readLegacySnapshots(wallet: string, labelId: number): Record<string, number> {
    try {
        const raw = localStorage.getItem(`snapshots:${wallet}:${labelId}`);
        return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch { return {}; }
}
