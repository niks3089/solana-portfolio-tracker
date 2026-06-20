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

app.use(express.static(join(__dirname, '../public')));
app.use('/api/', rateLimitMiddleware);

app.use('/api/portfolio', portfolioRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api', internalRoutes);

app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

app.listen(CONFIG.PORT, () => {
    console.log(`Portfolio Dashboard running on port ${CONFIG.PORT}`);
});

export default app;
