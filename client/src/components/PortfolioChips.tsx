import { Pencil, Plus } from 'lucide-react';
import type { Portfolio } from '../lib/portfolios.ts';

export function PortfolioChips({
    portfolios,
    activeId,
    onSelect,
    onEdit,
    onCreate,
}: {
    portfolios: Portfolio[];
    activeId: number | null;
    onSelect: (id: number) => void;
    onEdit: (id: number) => void;
    onCreate: () => void;
}) {
    return (
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <span>📁</span> Portfolios
                </h3>
                <button
                    onClick={onCreate}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10"
                >
                    <Plus size={12} /> New
                </button>
            </div>
            {portfolios.length === 0 ? (
                <p className="text-xs text-text-secondary">
                    Create portfolios to group multiple wallets.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {portfolios.map((p) => {
                        const isActive = activeId === p.id;
                        return (
                            <div
                                key={p.id}
                                className={[
                                    'group flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                                    isActive ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary',
                                ].join(' ')}
                                onClick={() => onSelect(p.id)}
                            >
                                <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                                <span>{p.name}</span>
                                <span className="text-[10px] opacity-60">({p.wallets.length})</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onEdit(p.id);
                                    }}
                                    className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                                >
                                    <Pencil size={11} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
