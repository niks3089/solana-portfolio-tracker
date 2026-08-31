export const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    INR: '₹',
};

let fxRate = 1;
let fxSymbol = '$';

export function setDisplayCurrency(code: string, rate: number): void {
    fxRate = rate > 0 ? rate : 1;
    fxSymbol = CURRENCY_SYMBOLS[code] || '$';
}

export function fmtUsd(usd: number | null | undefined): string {
    if (usd == null || !Number.isFinite(usd)) return '—';
    const n = usd * fxRate;
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${fxSymbol}${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${fxSymbol}${(n / 1_000).toFixed(2)}K`;
    if (abs >= 1) return `${fxSymbol}${n.toFixed(2)}`;
    if (abs >= 0.01) return `${fxSymbol}${n.toFixed(2)}`;
    if (abs === 0) return `${fxSymbol}0`;
    return `${fxSymbol}${n.toFixed(4)}`;
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
