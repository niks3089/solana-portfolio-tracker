import { useEffect, useState } from 'react';
import type { Portfolio, PortfolioWallet } from '../lib/portfolios.ts';

type Mode = { kind: 'create' } | { kind: 'edit'; portfolio: Portfolio };

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export function PortfolioModal({
    mode,
    onClose,
    onSave,
    onDelete,
}: {
    mode: Mode;
    onClose: () => void;
    onSave: (name: string, color: string, wallets: PortfolioWallet[]) => void;
    onDelete?: () => void;
}) {
    const initial = mode.kind === 'edit' ? mode.portfolio : null;
    const [name, setName] = useState(initial?.name || '');
    const [color, setColor] = useState(initial?.color || COLORS[0]!);
    const [walletsText, setWalletsText] = useState(
        (initial?.wallets || []).map((w) => w.address).join('\n'),
    );

    // Close on Escape.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const submit = () => {
        if (!name.trim()) return;
        const wallets: PortfolioWallet[] = walletsText
            .split(/[\s,]+/)
            .map((a) => a.trim())
            .filter((a) => a.length >= 32 && a.length <= 64)
            .map((address) => ({ address }));
        if (wallets.length === 0) return;
        onSave(name.trim(), color, wallets);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-xl border border-border bg-bg-secondary p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                        {mode.kind === 'edit' ? 'Edit Portfolio' : 'Create Portfolio'}
                    </h3>
                    <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
                        ×
                    </button>
                </div>

                <div className="mt-4 space-y-3">
                    <div>
                        <label className="block text-xs uppercase tracking-wide text-text-secondary">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. salary, OGs, trading"
                            className="mt-1 w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 outline-none focus:border-accent"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs uppercase tracking-wide text-text-secondary">Color</label>
                        <div className="mt-1 flex gap-2">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    className={[
                                        'h-7 w-7 rounded-full border-2 transition',
                                        c === color ? 'border-text-primary' : 'border-transparent',
                                    ].join(' ')}
                                    style={{ background: c }}
                                />
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs uppercase tracking-wide text-text-secondary">
                            Wallets (one per line)
                        </label>
                        <textarea
                            value={walletsText}
                            onChange={(e) => setWalletsText(e.target.value)}
                            rows={6}
                            placeholder="paste Solana addresses here, one per line"
                            className="mt-1 w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                        />
                    </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-2">
                    {mode.kind === 'edit' && onDelete ? (
                        <button
                            type="button"
                            onClick={onDelete}
                            className="rounded-md border border-negative/40 px-3 py-1.5 text-sm text-negative hover:bg-negative/10"
                        >
                            Delete
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg-primary hover:opacity-90"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
