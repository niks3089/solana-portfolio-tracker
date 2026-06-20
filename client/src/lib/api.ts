import type {
    DefiPosition,
    Holdings as ServerHoldings,
    TradePnLResult,
} from '@shared/types.ts';

export type AggregateFastResp = {
    wallet: 'aggregate';
    aggregate: {
        totalNetWorth: number;
        totalAssets: number;
        totalTokens: number;
        defiDeposits: number;
        defiBorrows: number;
    };
    tokens: Array<ServerHoldings['tokens'][number] & { wallet: string; walletShort: string }>;
    defiPositions: Array<DefiPosition & { wallet: string; walletShort: string }>;
};

export type DialectPositionsResp = {
    positions: Array<DefiPosition & { wallet: string; walletShort: string }>;
};

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    return res.json() as Promise<T>;
}

export function fetchAggregateFast(wallets: string[]): Promise<AggregateFastResp> {
    return getJSON('/api/portfolio/aggregate/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets }),
    });
}

export function fetchTradePnL(wallets: string[]): Promise<TradePnLResult> {
    return getJSON('/api/portfolio/trade-pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets }),
    });
}

export function fetchDialectPositions(wallets: string[]): Promise<DialectPositionsResp> {
    return getJSON('/api/portfolio/dialect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets }),
    });
}

export async function sendPing(event: 'signup' | 'usage', wallet: string): Promise<void> {
    try {
        await fetch('/api/internal/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, wallet }),
        });
    } catch {
        // fire-and-forget
    }
}
