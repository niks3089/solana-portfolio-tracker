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

// CSP: reduce the sessionStorage AES-key exfil surface. Wallet-adapter UIs
// need inline styles; token icons come from various CDNs (img-src https:).
// All app data flows through /api on the same origin, so connect-src stays 'self'.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:', 'https:'],
            'connect-src': ["'self'"],
            'font-src': ["'self'", 'data:'],
            'object-src': ["'none'"],
            'frame-src': ["'self'"],
            'base-uri': ["'self'"],
            'form-action': ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use((req, res, next) => {
    if (req.path.endsWith('.png') || req.path.endsWith('.json')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Trust exactly one proxy hop (nginx on the VM). Trusting all hops would
// let a direct request spoof X-Forwarded-For and bypass rate limiting.
app.set('trust proxy', 1);

const publicDir = join(__dirname, '../public');
const spaDir = join(publicDir, 'dist');

app.use(express.static(publicDir));
app.use('/api/', rateLimitMiddleware);

app.use('/api/portfolio', portfolioRoutes);
app.use('/api/vault', vaultRoutes);
// Single mount for the miscellaneous / internal routes (health, resolve,
// metrics, ping, etc.). Do NOT also mount at `/api/internal` — that just
// doubled the attack surface for no benefit.
app.use('/api', internalRoutes);

app.use('/app', express.static(spaDir));
app.get('/app/*', (_req, res) => {
    res.sendFile(join(spaDir, 'index.html'));
});
app.get('*', (_req, res) => {
    res.redirect('/app/');
});

app.listen(CONFIG.PORT, () => {
    console.log(`Portfolio Dashboard running on port ${CONFIG.PORT}`);
});

export default app;
