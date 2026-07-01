import { useState } from 'react';

const SOL_RE = /^[a-z0-9-]+\.sol$/i;

async function resolve(input: string): Promise<string | null> {
    const s = input.trim();
    if (!s) return null;
    if (SOL_RE.test(s)) {
        try {
            const r = await fetch(`/api/resolve/${encodeURIComponent(s)}`);
            if (!r.ok) return null;
            const body = (await r.json()) as { address?: string };
            return body.address || null;
        } catch { return null; }
    }
    // Raw pubkey (base58, 32-44 chars). Loose length check — server validates
    // strictly on lookup, wrong ones just show empty results.
    if (s.length >= 32 && s.length <= 44) return s;
    return null;
}

export function WalletInput({
    trackedWallets,
    onAdd,
    onRemove,
}: {
    trackedWallets: string[];
    onAdd: (address: string) => void;
    onRemove: (address: string) => void;
}) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const submit = async (raw?: string) => {
        setErr(null);
        setBusy(true);
        const addr = await resolve(raw ?? value);
        setBusy(false);
        if (!addr) { setErr('Not a valid wallet or .sol name.'); return; }
        if (!trackedWallets.includes(addr)) onAdd(addr);
        setValue('');
    };

    return (
        <div className="rounded-xl border border-border bg-bg-secondary p-3">
            <input
                type="text"
                value={value}
                placeholder="Add wallet or .sol name"
                onChange={(e) => { setValue(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim();
                    if (pasted) {
                        e.preventDefault();
                        setValue(pasted);
                        void submit(pasted);
                    }
                }}
                disabled={busy}
                className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
            {err && <p className="mt-1 text-xs text-negative">{err}</p>}
            {trackedWallets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {trackedWallets.map((w) => (
                        <span
                            key={w}
                            className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
                        >
                            <span className="font-mono">{w.slice(0, 4)}…{w.slice(-4)}</span>
                            <button
                                type="button"
                                onClick={() => onRemove(w)}
                                className="opacity-60 hover:opacity-100"
                                title="Remove"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
