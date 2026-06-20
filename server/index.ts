import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';

import { CONFIG } from './config.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import portfolioRoutes from './routes/portfolio.js';
import internalRoutes from './routes/internal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use((req, res, next) => {
    if (req.path.endsWith('.png') || req.path.endsWith('.json')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', true);

const publicDir = join(__dirname, '../public');
const spaDir = join(publicDir, 'dist');

app.use(express.static(publicDir));
app.use('/api/', rateLimitMiddleware);

app.use('/api/portfolio', portfolioRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api', internalRoutes);

// SPA (Vite-built) under /app — falls through to its own index.html for client-side routing.
app.use('/app', express.static(spaDir));
app.get('/app/*', (_req, res) => {
    res.sendFile(join(spaDir, 'index.html'));
});

// Legacy single-page UI keeps serving everything else.
app.get('*', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
});

app.listen(CONFIG.PORT, () => {
    console.log(`Portfolio Dashboard running on port ${CONFIG.PORT}`);
});

export default app;
