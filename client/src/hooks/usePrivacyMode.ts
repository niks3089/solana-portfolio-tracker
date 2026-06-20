import { useCallback, useEffect, useState } from 'react';

const KEY = 'portfolioPrivacyMode';

export function usePrivacyMode() {
    const [hidden, setHidden] = useState<boolean>(() => {
        try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch { /* ignore */ }
    }, [hidden]);

    const toggle = useCallback(() => setHidden((h) => !h), []);
    return { hidden, toggle };
}

// Render a numeric value as blurred / "•••" when privacy is on.
export function privatized(value: string, hidden: boolean): string {
    if (!hidden) return value;
    return '•••';
}
