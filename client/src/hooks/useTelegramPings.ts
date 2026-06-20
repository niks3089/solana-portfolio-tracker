import { useEffect, useRef } from 'react';
import { sendPing } from '../lib/api.ts';

// Fire-and-forget Telegram pings. Signup is per-wallet forever; usage is
// rate-limited to once per ~6h per wallet in localStorage (server also dedupes
// to ~1h).
export function useTelegramPings(wallet: string | null) {
    const lastWallet = useRef<string | null>(null);

    useEffect(() => {
        if (!wallet) {
            lastWallet.current = null;
            return;
        }
        if (lastWallet.current === wallet) return;
        lastWallet.current = wallet;

        // Signup: only once per wallet ever (in this browser).
        const signupKey = `signupPingSent:${wallet}`;
        if (!localStorage.getItem(signupKey)) {
            localStorage.setItem(signupKey, '1');
            sendPing('signup', wallet);
        }

        // Usage: at most once per 6h.
        const usageKey = `usagePingAt:${wallet}`;
        const last = Number.parseInt(localStorage.getItem(usageKey) || '0', 10);
        if (Date.now() - last >= 6 * 60 * 60 * 1000) {
            localStorage.setItem(usageKey, String(Date.now()));
            sendPing('usage', wallet);
        }
    }, [wallet]);
}
