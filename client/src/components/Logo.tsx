export function Logo({ size = 24 }: { size?: number }) {
    // Saturn-ring planet, ported verbatim from the legacy public/index.html header.
    return (
        <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="45" fill="#0a0a0f" stroke="#22c55e" strokeWidth="5" />
            <ellipse cx="50" cy="50" rx="45" ry="20" fill="none" stroke="#22c55e" strokeWidth="3" />
            <ellipse cx="50" cy="50" rx="20" ry="45" fill="none" stroke="#22c55e" strokeWidth="3" />
            <line x1="5" y1="50" x2="95" y2="50" stroke="#22c55e" strokeWidth="3" />
        </svg>
    );
}
