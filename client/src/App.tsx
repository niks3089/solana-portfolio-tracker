import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Portfolio } from './pages/Portfolio.tsx';
import { Holdings } from './pages/Holdings.tsx';
import { History } from './pages/History.tsx';
import { Returns } from './pages/Returns.tsx';

const tabs = [
    { to: '/portfolio', label: 'Portfolio' },
    { to: '/holdings', label: 'Holdings' },
    { to: '/history', label: 'Trade History' },
    { to: '/returns', label: 'Returns' },
];

export function App() {
    return (
        <div className="min-h-full">
            <header className="border-b border-border bg-bg-secondary">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <h1 className="text-lg font-semibold text-accent">Portfolio</h1>
                    <nav className="flex gap-1">
                        {tabs.map((t) => (
                            <NavLink
                                key={t.to}
                                to={t.to}
                                className={({ isActive }) =>
                                    [
                                        'rounded-md px-3 py-1.5 text-sm transition-colors',
                                        isActive
                                            ? 'bg-bg-tertiary text-text-primary'
                                            : 'text-text-secondary hover:text-text-primary',
                                    ].join(' ')
                                }
                            >
                                {t.label}
                            </NavLink>
                        ))}
                    </nav>
                </div>
            </header>
            <main className="mx-auto max-w-6xl px-6 py-8">
                <Routes>
                    <Route path="/" element={<Navigate to="/portfolio" replace />} />
                    <Route path="/portfolio" element={<Portfolio />} />
                    <Route path="/holdings" element={<Holdings />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/returns" element={<Returns />} />
                </Routes>
            </main>
        </div>
    );
}
