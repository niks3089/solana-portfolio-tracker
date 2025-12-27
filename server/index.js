/**
 * Portfolio Dashboard Server
 * Main entry point
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';

import { CONFIG } from './config.js';
import { initDatabase } from './db.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { heliusWS } from './services/helius-ws.js';

// Routes
import portfolioRoutes from './routes/portfolio.js';
import paymentsRoutes from './routes/payments.js';
import usersRoutes from './routes/users.js';
import labelsRoutes from './routes/labels.js';
import alertsRoutes from './routes/alerts.js';
import internalRoutes from './routes/internal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// CORS for icons and manifest (needed for PWABuilder)
app.use((req, res, next) => {
    if (req.path.endsWith('.png') || req.path.endsWith('.json')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    next();
});

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(join(__dirname, '../public')));

// Rate limiting for API routes
app.use('/api/', rateLimitMiddleware);

// API Routes
app.use('/api/portfolio', portfolioRoutes);
app.use('/api', paymentsRoutes);  // payment-config, pro-status, payments, discount
app.use('/api/users', usersRoutes);
app.use('/api/labels', labelsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api', internalRoutes);  // /api/health, /api/metrics

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
initDatabase().then(() => {
    app.listen(CONFIG.PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║           PORTFOLIO DASHBOARD - Running on port ${CONFIG.PORT}           ║
╚════════════════════════════════════════════════════════════════╝

  Open: http://localhost:${CONFIG.PORT}

  API Endpoints:
    GET  /api/portfolio/:wallet      - Get single wallet portfolio
    POST /api/portfolio/aggregate    - Get aggregated portfolio
    GET  /api/payment-config         - Get payment wallet info
    GET  /api/pro-status/:wallet     - Check Pro status
    POST /api/payments               - Record a payment
    GET  /api/labels/:wallet         - Get user's labels
    GET  /api/alerts/:wallet         - Get user's alerts
    GET  /api/health                 - Health check
`);

        // Connect to Helius WebSocket for real-time alerts
        heliusWS.connect();
    });
});

export default app;

