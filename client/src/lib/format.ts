export function fmtUsd(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
    if (abs >= 1) return `$${n.toFixed(2)}`;
    if (abs >= 0.01) return `$${n.toFixed(2)}`;
    if (abs === 0) return '$0';
    return `$${n.toFixed(4)}`;
}

export function fmtNum(n: number | null | undefined, decimals = 4): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function fmtPct(p: number | null | undefined, decimals = 1): string {
    if (p == null || !Number.isFinite(p)) return '—';
    const sign = p >= 0 ? '+' : '';
    return `${sign}${p.toFixed(decimals)}%`;
}

export function shortAddr(addr: string | undefined): string {
    if (!addr) return '?';
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function fmtDate(unixSec: number | null | undefined): string {
    if (!unixSec) return '—';
    return new Date(unixSec * 1000).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}
