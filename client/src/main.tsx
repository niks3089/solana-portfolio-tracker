import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App.tsx';
import { WalletProviders } from './WalletProviders.tsx';
import './styles.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <WalletProviders>
                <BrowserRouter basename="/app">
                    <App />
                </BrowserRouter>
            </WalletProviders>
        </QueryClientProvider>
    </StrictMode>,
);
