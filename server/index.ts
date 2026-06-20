import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';

import { CONFIG } from './config.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import portfolioRoutes from './routes/portfolio.js';
import internalRoutes from './routes/internal.js';
import vaultRoutes from './routes/vault.js';

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

// Static assets (icons, manifest, sw.js, etc.) served from /public.
app.use(express.static(publicDir));
app.use('/api/', rateLimitMiddleware);

app.use('/api/portfolio', portfolioRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api', internalRoutes);

// SPA: Vite build output at /app/*, falls back to the SPA's own index.html
// for any client-side route so React Router can handle it.
app.use('/app', express.static(spaDir));
app.get('/app/*', (_req, res) => {
    res.sendFile(join(spaDir, 'index.html'));
});

// Root + any other path → redirect into the SPA.
app.get('*', (_req, res) => {
    res.redirect('/app/');
});

app.listen(CONFIG.PORT, () => {
    console.log(`Portfolio Dashboard running on port ${CONFIG.PORT}`);
});

export default app;
