import type { ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';

export function SortableHeader<K extends string>({
    col,
    label,
    activeCol,
    dir,
    onSort,
    align = 'left',
    children,
}: {
    col: K;
    label?: string;
    activeCol: K;
    dir: SortDir;
    onSort: (col: K) => void;
    align?: 'left' | 'right';
    children?: ReactNode;
}) {
    const isActive = activeCol === col;
    const icon = !isActive ? ' ↕' : dir === 'asc' ? ' ↑' : ' ↓';
    return (
        <th
            onClick={() => onSort(col)}
            className={[
                'cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary',
                'hover:text-text-primary',
                isActive ? 'text-text-primary' : '',
                align === 'right' ? 'text-right' : 'text-left',
            ].join(' ')}
        >
            {children ?? label}
            <span className="ml-1 text-[10px] opacity-60">{icon}</span>
        </th>
    );
}
