import { useState } from 'react';

// Top-of-page input for adding a single wallet to track on the fly, without
// creating a portfolio. Matches the legacy "Add wallet" box from index.html.
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

    const submit = () => {
        const addr = value.trim();
        if (addr.length < 32 || addr.length > 64) return;
        if (trackedWallets.includes(addr)) {
            setValue('');
            return;
        }
        onAdd(addr);
        setValue('');
    };

    return (
        <div className="rounded-xl border border-border bg-bg-secondary p-3">
            <input
                type="text"
                value={value}
                placeholder="Add wallet"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim();
                    if (pasted.length >= 32) {
                        setTimeout(() => {
                            if (!trackedWallets.includes(pasted)) onAdd(pasted);
                            setValue('');
                        }, 0);
                    }
                }}
                className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm outline-none focus:border-accent"
            />
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
