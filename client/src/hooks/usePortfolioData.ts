import { useQuery } from '@tanstack/react-query';
import { fetchAggregateFast, fetchDialectPositions, fetchTradePnL } from '../lib/api.ts';

export function useAggregateFast(wallets: string[]) {
    return useQuery({
        queryKey: ['aggregate', ...[...wallets].sort()],
        queryFn: () => fetchAggregateFast(wallets),
        enabled: wallets.length > 0,
    });
}

export function useTradePnL(wallets: string[]) {
    return useQuery({
        queryKey: ['trade-pnl', ...[...wallets].sort()],
        queryFn: () => fetchTradePnL(wallets),
        enabled: wallets.length > 0,
        staleTime: 5 * 60 * 1000,
    });
}

export function useDialectPositions(wallets: string[]) {
    return useQuery({
        queryKey: ['dialect', ...[...wallets].sort()],
        queryFn: () => fetchDialectPositions(wallets),
        enabled: wallets.length > 0,
    });
}
