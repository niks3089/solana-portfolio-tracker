/**
 * Portfolio Dashboard Server
 * Minimal backend for multi-wallet portfolio tracking
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { LRUCache } from 'lru-cache';

const { Pool } = pg;

// ============================================================================
// LRU Cache - 5 minute TTL, 100k max entries
// ============================================================================
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for individual wallet data (reusable across aggregates)
const holdingsCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
const lambdaDefiCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
const dialectDefiCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
const pnlCache = new LRUCache({ max: 100000, ttl: CACHE_TTL }); // key: wallet:tokenAddress

// ============================================================================
// Metrics tracking
// ============================================================================
const metrics = {
  startTime: Date.now(),

  // Cache stats
  cache: {
    hits: 0,
    misses: 0,
    holdings: { size: 0 },
    lambdaDefi: { size: 0 },
    dialectDefi: { size: 0 },
    pnl: { size: 0 },
  },

  // API call stats per provider
  api: {
    birdeye: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
    lambda: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
    dialect: { calls: 0, errors: 0, timeouts: 0, totalLatencyMs: 0, latencies: [] },
  },

  // Request stats
  requests: {
    total: 0,
    byEndpoint: {},
  },

  // Unique wallets seen
  uniqueWallets: new Set(),
};

function getApiProvider(url) {
  if (url.includes('birdeye.so')) return 'birdeye';
  if (url.includes('lambda.p2p.org')) return 'lambda';
  if (url.includes('dial.to')) return 'dialect';
  return null;
}

function recordApiCall(provider, latencyMs, error = null, isTimeout = false) {
  if (!metrics.api[provider]) return;

  const stats = metrics.api[provider];
  stats.calls++;
  stats.totalLatencyMs += latencyMs;

  // Keep last 100 latencies for percentile calculation
  stats.latencies.push(latencyMs);
  if (stats.latencies.length > 100) stats.latencies.shift();

  if (isTimeout) stats.timeouts++;
  else if (error) stats.errors++;
}

function updateCacheSizes() {
  metrics.cache.holdings.size = holdingsCache.size;
  metrics.cache.lambdaDefi.size = lambdaDefiCache.size;
  metrics.cache.dialectDefi.size = dialectDefiCache.size;
  metrics.cache.pnl.size = pnlCache.size;
}

function getPercentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getCacheKey(wallets) {
  // Sort wallets to ensure consistent key regardless of order
  return [...wallets].sort().join('|');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Trust proxy (Nginx) for rate limiting
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for inline scripts
}));

// Rate limiting: 60 requests per minute per IP
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Config
const CONFIG = {
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || 'e4303524dbf9450188bc9d92e1d21b72',
  DIALECT_API_KEY: process.env.DIALECT_API_KEY || 'sk_usjjgv83q3jrlvqg2fwilsi7',
  LAMBDA_P2P_API_KEY: process.env.LAMBDA_P2P_API_KEY || 'feMLcQShh5WNpbgE4zgAAz3iWDAzvoCL',
  PAYMENT_WALLET: process.env.PAYMENT_WALLET || '2P2QaYCyjXiSqygKxrN4mREnTENTL4oQ64kN5nx4XPaX',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/portfolio_dashboard',
  PORT: process.env.PORT || 3000,
  SUBSCRIPTION_DAYS: 30,
  // Free mode - everything unlocked, no wallet connection required
  FREE_MODE: process.env.FREE_MODE === 'true',
};

// Discount codes
const DISCOUNT_CODES = {
  'samay123': 100, // 100% off (free)
  'HELIUS50': 50,  // 50% off
};

// PostgreSQL connection pool
const pool = new Pool({ connectionString: CONFIG.DATABASE_URL });

// Initialize database tables on startup
async function initDatabase() {
  try {
    // ============================================================================
    // Users table - central user identity (wallet as primary key)
    // Created when user first connects wallet
    // ============================================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        wallet VARCHAR(64) PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // ============================================================================
    // Payments table - tracks subscriptions (references users)
    // ============================================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        wallet VARCHAR(64) NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
        tx_signature VARCHAR(128) UNIQUE,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USDC',
        paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        discount_code VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payments_wallet ON payments(wallet);
      CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    `);

    // ============================================================================
    // Labels table - wallet groupings (references users)
    // - 1 owner can have max 3 labels (enforced in app)
    // - 1 label belongs to exactly 1 owner
    // - name doesn't need to be unique
    // ============================================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS labels (
        id SERIAL PRIMARY KEY,
        owner_wallet VARCHAR(64) NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(7) DEFAULT '#00D18C',
        wallets JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_labels_owner ON labels(owner_wallet);
    `);
    // wallets JSONB format: [{"address": "5bAM...", "name": "Main"}, {"address": "86xC...", "name": "Trading"}]

    // ============================================================================
    // Label snapshots - historical portfolio data (time-series)
    // Populated by daily cron job via /api/internal/snapshot
    // ============================================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS label_snapshots (
        id SERIAL PRIMARY KEY,
        label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
        total_net_worth DECIMAL(20, 2) DEFAULT 0,
        total_tokens DECIMAL(20, 2) DEFAULT 0,
        defi_deposits DECIMAL(20, 2) DEFAULT 0,
        defi_borrows DECIMAL(20, 2) DEFAULT 0,
        total_pnl DECIMAL(20, 2) DEFAULT 0,
        wallet_count INTEGER DEFAULT 0,
        UNIQUE(label_id, snapshot_date)
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_label ON label_snapshots(label_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_date ON label_snapshots(snapshot_date DESC);
    `);

    console.log('✓ Database tables initialized (users, payments, labels, label_snapshots)');
  } catch (error) {
    console.error('⚠ Database initialization skipped (will work without persistence):', error.message);
  }
}

// ============================================================================
// API Helpers
// ============================================================================

async function fetchJSON(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  const urlHost = new URL(url).hostname;
  const provider = getApiProvider(url);

  try {
    const response = await fetch(url, {
      ...options,
      headers: { 'accept': 'application/json', ...options.headers },
      signal: controller.signal,
    });
    const elapsed = Date.now() - startTime;

    // Record successful API call
    if (provider) recordApiCall(provider, elapsed);

    if (elapsed > 5000) {
      console.log(`⚠️ Slow API: ${urlHost} took ${elapsed}ms`);
    }
    return response.json();
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError';

    // Record failed API call
    if (provider) recordApiCall(provider, elapsed, err, isTimeout);

    if (isTimeout) {
      console.error(`❌ TIMEOUT: ${urlHost} did not respond in ${timeoutMs}ms`);
      console.error(`   → This usually means the external API is down or overloaded`);
      console.error(`   → The request will be retried on next user action`);
    } else {
      console.error(`❌ API Error: ${urlHost} failed after ${elapsed}ms - ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Native SOL address needs to be mapped to Wrapped SOL for P&L lookup
const NATIVE_SOL = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

// Get token holdings from Birdeye (with cache)
async function getTokenHoldings(wallet) {
  // Check cache first
  const cached = holdingsCache.get(wallet);
  if (cached) {
    metrics.cache.hits++;
    return cached;
  }
  metrics.cache.misses++;

  const data = await fetchJSON(
    `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
    { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
  );

  if (!data.success) return { tokens: [], totalUsd: 0 };

  const result = {
    totalUsd: data.data.totalUsd,
    tokens: data.data.items.map(t => ({
      symbol: t.symbol,
      name: t.name,
      balance: t.uiAmount,
      price: t.priceUsd,
      value: t.valueUsd,
      icon: t.icon || t.logoURI,
      // Map native SOL to wrapped SOL for P&L lookup
      address: t.address === NATIVE_SOL ? WRAPPED_SOL : t.address,
    })).filter(t => t.value > 0.01),
  };

  holdingsCache.set(wallet, result);
  return result;
}

// Get P&L for a token (with cache)
async function getTokenPnL(tokenAddress, wallet) {
  const cacheKey = `${wallet}:${tokenAddress}`;

  // Check cache first
  const cached = pnlCache.get(cacheKey);
  if (cached !== undefined) {
    metrics.cache.hits++;
    return cached;
  }
  metrics.cache.misses++;

  try {
    const data = await fetchJSON(
      `https://public-api.birdeye.so/wallet/v2/pnl/multiple?token_address=${tokenAddress}&wallets=${wallet}`,
      { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
    );

    if (!data.data?.data?.[wallet]) {
      pnlCache.set(cacheKey, null);
      return null;
    }

    const d = data.data.data[wallet];
    const result = {
      address: tokenAddress,
      symbol: data.data.token_metadata?.symbol,
      invested: d.cashflow_usd?.total_invested || 0,
      currentValue: d.cashflow_usd?.current_value || 0,
      realizedPnL: d.pnl?.realized_profit_usd || 0,
      unrealizedPnL: d.pnl?.unrealized_usd || 0,
      totalPnL: d.pnl?.total_usd || 0,
      totalPnLPercent: (d.pnl?.total_percent || 0) * 100,
      avgBuyPrice: d.pricing?.avg_buy_cost || 0,
    };

    pnlCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return null;
  }
}

// Get DeFi positions from Dialect (with cache)
async function getDialectPositions(wallet) {
  // Check cache first
  const cached = dialectDefiCache.get(wallet);
  if (cached) {
    metrics.cache.hits++;
    return cached;
  }
  metrics.cache.misses++;

  try {
    const data = await fetchJSON(
      `https://markets.dial.to/api/v0/positions/owners?walletAddresses=${wallet}`,
      { headers: { 'x-dialect-api-key': CONFIG.DIALECT_API_KEY } }
    );
    if (!data.positions) {
      dialectDefiCache.set(wallet, []);
      return [];
    }

    // Stablecoins where 1 token ≈ $1
    const stablecoins = ['USDC', 'USDT', 'PYUSD', 'DAI', 'USDH', 'USH', 'UXD'];

    const result = data.positions.map(pos => {
      const amount = pos.amount || 0;
      const symbol = pos.market?.token?.symbol || '';
      // Calculate value: use amountUsd if available, otherwise estimate for stablecoins
      let value = pos.amountUsd;
      if (value === null || value === undefined) {
        value = stablecoins.includes(symbol.toUpperCase()) ? amount : 0;
      }

      return {
        protocol: pos.market?.provider?.name || 'Unknown',
        protocolIcon: pos.market?.provider?.icon,
        token: symbol,
        tokenIcon: pos.market?.token?.icon,
        type: pos.side || pos.type || 'deposit',
        amount,
        value,
        apy: (pos.market?.depositApy || pos.market?.borrowApy || 0) * 100,
        source: 'dialect',
      };
    });

    dialectDefiCache.set(wallet, result);
    return result;
  } catch (e) {
    console.error('Dialect error:', e.message);
    return [];
  }
}

// Get DeFi positions from Lambda P2P (with cache)
async function getLambdaPositions(wallet) {
  // Check cache first
  const cached = lambdaDefiCache.get(wallet);
  if (cached) {
    metrics.cache.hits++;
    return cached;
  }
  metrics.cache.misses++;

  try {
    const data = await fetchJSON(
      `https://api.lambda.p2p.org/api/v1/chains/solana/wallets/${wallet}/balances`,
      { headers: { 'Authorization': CONFIG.LAMBDA_P2P_API_KEY } }
    );

    if (!data.data?.assets) {
      lambdaDefiCache.set(wallet, []);
      return [];
    }

    const positions = [];
    for (const asset of data.data.assets) {
      if (asset.type !== 'position') continue;

      const protocol = asset.defi_name || 'Unknown';
      const protocolIcon = asset.defi_icon_url;

      // Process deposits
      for (const dep of asset.attributes?.deposits || []) {
        positions.push({
          protocol,
          protocolIcon,
          token: dep.token_symbol,
          tokenIcon: dep.attributes?.icon_url,
          type: 'deposit',
          amount: dep.amount || 0,
          value: dep.value_usd || 0,
          apy: 0,
          source: 'lambda',
        });
      }

      // Process loans/borrows
      for (const loan of asset.attributes?.loans || []) {
        positions.push({
          protocol,
          protocolIcon,
          token: loan.token_symbol,
          tokenIcon: loan.attributes?.icon_url,
          type: 'borrow',
          amount: loan.amount || 0,
          value: loan.value_usd || 0,
          apy: 0,
          source: 'lambda',
        });
      }
    }

    lambdaDefiCache.set(wallet, positions);
    return positions;
  } catch (e) {
    console.error('Lambda P2P error:', e.message);
    return [];
  }
}

// Get combined DeFi positions
// Fast DeFi - Lambda only (instant, ~500ms)
async function getDefiPositionsFast(wallet) {
  const lambdaPos = await getLambdaPositions(wallet);

  let totalDeposits = 0;
  let totalBorrows = 0;
  for (const pos of lambdaPos) {
    if (pos.type === 'borrow') totalBorrows += pos.value;
    else totalDeposits += pos.value;
  }

  return {
    positions: lambdaPos.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    totalDeposits,
    totalBorrows,
  };
}

// Full DeFi - Lambda + Dialect (slower, includes rewards)
async function getDefiPositions(wallet) {
  const [dialectPos, lambdaPos] = await Promise.all([
    getDialectPositions(wallet),
    getLambdaPositions(wallet),
  ]);

  // Deduplicate by exact (protocol, token, type) - not just protocol
  // This allows Lambda deposits + Dialect rewards for same protocol
  const dialectKeys = new Set(
    dialectPos.map(p => `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`)
  );

  const uniqueLambdaPos = lambdaPos.filter(p => {
    const key = `${p.protocol.toLowerCase()}|${(p.token || '').toLowerCase()}|${p.type}`;
    return !dialectKeys.has(key);
  });

  const allPositions = [...dialectPos, ...uniqueLambdaPos];

  let totalDeposits = 0;
  let totalBorrows = 0;

  for (const pos of allPositions) {
    if (pos.type === 'borrow') totalBorrows += pos.value;
    else totalDeposits += pos.value;
  }

  return {
    positions: allPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    totalDeposits,
    totalBorrows,
  };
}

// ============================================================================
// SNS (.sol) Domain Resolution
// ============================================================================

const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=ed2c2720-f40d-44d0-83be-ee7f3b8d5359';

// Resolve .sol domain to wallet address using Helius
async function resolveSolDomain(domain) {
  // Remove .sol suffix if present
  const name = domain.toLowerCase().replace(/\.sol$/, '');

  try {
    // Use Helius DAS API to resolve SNS domain
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: name + '.sol',
          page: 1,
          limit: 1,
        },
      }),
    });

    // If that doesn't work, try the SNS SDK approach via public API
    const snsResponse = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`);
    if (snsResponse.ok) {
      const data = await snsResponse.json();
      if (data.result) {
        return { success: true, address: data.result, domain: name + '.sol' };
      }
    }

    return { success: false, error: 'Domain not found' };
  } catch (e) {
    console.error('SNS resolution error:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================================
// API Routes
// ============================================================================

// Get portfolio history (net worth over time)
app.get('/api/portfolio/history/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { days = '7' } = req.query;

    // Birdeye supports max 30 days
    const count = Math.min(parseInt(days) || 7, 30);

    const data = await fetchJSON(
      `https://public-api.birdeye.so/wallet/v2/net-worth?wallet=${wallet}&count=${count}&direction=back&type=1d&sort_type=asc`,
      { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
    );

    if (!data.success || !data.data?.history) {
      return res.json({ success: false, history: [] });
    }

    res.json({
      success: true,
      wallet: data.data.wallet_address,
      history: data.data.history.map(h => ({
        timestamp: h.timestamp,
        netWorth: h.net_worth,
        change: h.net_worth_change,
        changePercent: h.net_worth_change_percent
      }))
    });
  } catch (error) {
    console.error('Portfolio history error:', error);
    res.status(500).json({ success: false, error: error.message, history: [] });
  }
});

// Resolve .sol domain to address
app.get('/api/resolve/:domain', async (req, res) => {
  const { domain } = req.params;

  // Check if it looks like a .sol domain
  if (!domain.toLowerCase().endsWith('.sol')) {
    return res.json({ success: false, error: 'Not a .sol domain' });
  }

  const result = await resolveSolDomain(domain);
  res.json(result);
});

// Get FAST portfolio (Lambda DeFi only, no P&L, no Dialect) - ~1-2 seconds
app.get('/api/portfolio/fast/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const start = Date.now();

    // Fetch holdings and Lambda DeFi in parallel (skip Dialect + P&L for speed)
    const [holdings, defi] = await Promise.all([
      getTokenHoldings(wallet),
      getDefiPositionsFast(wallet),  // Lambda only - fast!
    ]);

    const totalTokens = holdings.totalUsd;
    const totalAssets = totalTokens + defi.totalDeposits;
    const totalNetWorth = totalAssets - defi.totalBorrows;

    console.log(`⚡ Fast portfolio for ${wallet.slice(0, 8)}... in ${Date.now() - start}ms`);

    res.json({
      wallet,
      summary: {
        totalNetWorth,
        totalAssets,
        totalTokens,
        defiDeposits: defi.totalDeposits,
        defiBorrows: defi.totalBorrows,
        totalPnL: null, // Will be loaded separately
      },
      tokens: holdings.tokens,
      defiPositions: defi.positions,
    });
  } catch (error) {
    console.error('Fast portfolio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get P&L for wallets (slow, load separately)
app.post('/api/portfolio/pnl', async (req, res) => {
  try {
    const { wallets } = req.body;
    if (!wallets?.length) {
      return res.status(400).json({ error: 'No wallets provided' });
    }

    // Track metrics
    metrics.requests.total++;
    metrics.requests.byEndpoint['/api/portfolio/pnl'] = (metrics.requests.byEndpoint['/api/portfolio/pnl'] || 0) + 1;

    const start = Date.now();
    let totalPnL = 0;
    const tokenPnLs = [];

    // Process each wallet
    for (const wallet of wallets) {
      // Get token holdings first
      const holdings = await getTokenHoldings(wallet);
      const significantTokens = holdings.tokens.filter(t => t.value > 1);

      // Get P&L for significant tokens
      const pnlResults = await Promise.all(
        significantTokens.map(t => getTokenPnL(t.address, wallet))
      );

      for (const pnl of pnlResults) {
        if (pnl) {
          totalPnL += pnl.totalPnL || 0;
          tokenPnLs.push({ ...pnl, wallet });
        }
      }
    }

    console.log(`📊 P&L for ${wallets.length} wallet(s) in ${Date.now() - start}ms`);

    res.json({ totalPnL, tokenPnLs });
  } catch (error) {
    console.error('P&L error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Dialect DeFi positions (for background loading - slow)
app.post('/api/portfolio/dialect', async (req, res) => {
  try {
    const { wallets } = req.body;
    if (!wallets?.length) {
      return res.status(400).json({ error: 'No wallets provided' });
    }

    // Track metrics
    metrics.requests.total++;
    metrics.requests.byEndpoint['/api/portfolio/dialect'] = (metrics.requests.byEndpoint['/api/portfolio/dialect'] || 0) + 1;

    const start = Date.now();
    const allPositions = [];

    for (const wallet of wallets) {
      const positions = await getDialectPositions(wallet);
      const walletShort = wallet.slice(0, 4) + '...' + wallet.slice(-4);
      for (const pos of positions) {
        allPositions.push({ ...pos, wallet, walletShort });
      }
    }

    console.log(`🗣️ Dialect for ${wallets.length} wallet(s) in ${Date.now() - start}ms (${allPositions.length} positions)`);

    res.json({
      positions: allPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      totalRewards: allPositions.filter(p => p.type === 'reward').reduce((sum, p) => sum + (p.value || 0), 0),
    });
  } catch (error) {
    console.error('Dialect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get full portfolio for a wallet (includes P&L - slower)
app.get('/api/portfolio/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Fetch all data in parallel
    const [holdings, defi] = await Promise.all([
      getTokenHoldings(wallet),
      getDefiPositions(wallet),
    ]);

    // Get P&L for all tokens with value > $1
    const significantTokens = holdings.tokens.filter(t => t.value > 1);
    const pnlPromises = significantTokens.map(t => getTokenPnL(t.address, wallet));
    const pnlResults = await Promise.all(pnlPromises);

    // Create address->PnL map for fast lookup
    const pnlMap = new Map();
    pnlResults.forEach(p => { if (p) pnlMap.set(p.address, p); });

    // Merge P&L into tokens by address
    const tokensWithPnL = holdings.tokens.map(token => {
      const pnl = pnlMap.get(token.address);
      return { ...token, pnl };
    });

    // Calculate totals
    const totalTokens = holdings.totalUsd;
    const totalAssets = totalTokens + defi.totalDeposits;
    const totalNetWorth = totalAssets - defi.totalBorrows;
    const totalPnL = Array.from(pnlMap.values()).reduce((sum, p) => sum + (p?.totalPnL || 0), 0);

    res.json({
      wallet,
      summary: {
        totalNetWorth,
        totalAssets,
        totalTokens,
        defiDeposits: defi.totalDeposits,
        defiBorrows: defi.totalBorrows,
        totalPnL,
      },
      tokens: tokensWithPnL,
      defiPositions: defi.positions,
    });
  } catch (error) {
    console.error('Portfolio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get FAST aggregated portfolio (no P&L) - ~3-5 seconds
app.post('/api/portfolio/aggregate/fast', async (req, res) => {
  try {
    const { wallets } = req.body;
    if (!wallets?.length) {
      return res.status(400).json({ error: 'No wallets provided' });
    }

    // Track metrics
    metrics.requests.total++;
    metrics.requests.byEndpoint['/api/portfolio/aggregate/fast'] = (metrics.requests.byEndpoint['/api/portfolio/aggregate/fast'] || 0) + 1;
    wallets.forEach(w => metrics.uniqueWallets.add(w));

    const start = Date.now();

    // Fetch all fast portfolios in parallel
    const portfolios = await Promise.all(
      wallets.map(async wallet => {
        const response = await fetch(`http://localhost:${CONFIG.PORT}/api/portfolio/fast/${wallet}`);
        return response.json();
      })
    );

    // Aggregate (same logic as full aggregate)
    const aggregate = {
      totalNetWorth: 0,
      totalAssets: 0,
      totalTokens: 0,
      defiDeposits: 0,
      defiBorrows: 0,
      totalPnL: null, // Will be loaded separately
    };

    const tokenMap = new Map();
    const allDefiPositions = [];

    for (const p of portfolios) {
      if (p.error || !p.summary) continue;
      const walletShort = p.wallet ? p.wallet.slice(0, 4) + '...' + p.wallet.slice(-4) : '?';

      aggregate.totalNetWorth += p.summary.totalNetWorth || 0;
      aggregate.totalAssets += p.summary.totalAssets || 0;
      aggregate.totalTokens += p.summary.totalTokens || 0;
      aggregate.defiDeposits += p.summary.defiDeposits || 0;
      aggregate.defiBorrows += p.summary.defiBorrows || 0;

      for (const token of p.tokens || []) {
        const key = `${token.symbol}_${p.wallet}`;
        tokenMap.set(key, { ...token, wallet: p.wallet, walletShort });
      }

      for (const pos of p.defiPositions || []) {
        allDefiPositions.push({ ...pos, wallet: p.wallet, walletShort });
      }
    }

    console.log(`⚡ Fast aggregate for ${wallets.length} wallet(s) in ${Date.now() - start}ms`);

    res.json({
      wallets,
      aggregate,
      tokens: Array.from(tokenMap.values()).sort((a, b) => b.value - a.value),
      defiPositions: allDefiPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    });
  } catch (error) {
    console.error('Fast aggregate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get aggregated portfolio for multiple wallets (full, includes P&L)
app.post('/api/portfolio/aggregate', async (req, res) => {
  try {
    const { wallets } = req.body;
    if (!wallets?.length) {
      return res.status(400).json({ error: 'No wallets provided' });
    }

    // Fetch all portfolios in parallel
    const portfolios = await Promise.all(
      wallets.map(async wallet => {
        const response = await fetch(`http://localhost:${CONFIG.PORT}/api/portfolio/${wallet}`);
        return response.json();
      })
    );

    // Aggregate
    const aggregate = {
      totalNetWorth: 0,
      totalAssets: 0,
      totalTokens: 0,
      defiDeposits: 0,
      defiBorrows: 0,
      totalPnL: 0,
    };

    const tokenMap = new Map();
    const allDefiPositions = [];

    for (const p of portfolios) {
      if (p.error || !p.summary) continue;

      const walletShort = p.wallet ? p.wallet.slice(0, 4) + '...' + p.wallet.slice(-4) : '?';

      aggregate.totalNetWorth += p.summary.totalNetWorth || 0;
      aggregate.totalAssets += p.summary.totalAssets || 0;
      aggregate.totalTokens += p.summary.totalTokens || 0;
      aggregate.defiDeposits += p.summary.defiDeposits || 0;
      aggregate.defiBorrows += p.summary.defiBorrows || 0;
      aggregate.totalPnL += p.summary.totalPnL || 0;

      // Aggregate tokens with wallet info
      for (const token of p.tokens) {
        const key = `${token.symbol}_${p.wallet}`;
        tokenMap.set(key, {
          ...token,
          wallet: p.wallet,
          walletShort,
        });
      }

      // Add wallet info to positions
      for (const pos of p.defiPositions) {
        allDefiPositions.push({ ...pos, wallet: p.wallet, walletShort });
      }
    }

    res.json({
      wallets,
      aggregate,
      tokens: Array.from(tokenMap.values()).sort((a, b) => b.value - a.value),
      defiPositions: allDefiPositions.sort((a, b) => b.value - a.value),
      portfolios,
    });
  } catch (error) {
    console.error('Aggregate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const checks = { status: 'ok', timestamp: new Date().toISOString(), checks: {} };

  // Check Birdeye API
  try {
    const start = Date.now();
    await fetchJSON('https://public-api.birdeye.so/defi/price?address=So11111111111111111111111111111111111111112',
      { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }, 5000);
    checks.checks.birdeye = { status: 'ok', latency: Date.now() - start };
  } catch (e) {
    checks.checks.birdeye = { status: 'error', error: e.message };
    checks.status = 'degraded';
  }

  // Check Lambda API
  try {
    const start = Date.now();
    await fetchJSON('https://api.lambda.p2p.org/api/v1/chains',
      { headers: { 'Authorization': CONFIG.LAMBDA_P2P_API_KEY } }, 5000);
    checks.checks.lambda = { status: 'ok', latency: Date.now() - start };
  } catch (e) {
    checks.checks.lambda = { status: 'error', error: e.message };
    checks.status = 'degraded';
  }

  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

// Payment config - $1/month in USDC (launch offer, normally $3)
app.get('/api/payment-config', (req, res) => {
  res.json({
    wallet: CONFIG.PAYMENT_WALLET,
    amount: 1, // $1 USDC (launch offer)
    originalAmount: 3, // Original price for strikethrough display
    token: 'USDC',
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    tokenDecimals: 6,
    durationDays: CONFIG.SUBSCRIPTION_DAYS,
    network: 'mainnet-beta',
    freeMode: CONFIG.FREE_MODE, // If true, everything is free
  });
});

// ============================================================================
// Payment & Subscription API
// ============================================================================

// Check Pro status for a wallet
app.get('/api/pro-status/:wallet', async (req, res) => {
  // In free mode, everyone is Pro
  if (CONFIG.FREE_MODE) {
    return res.json({ isPro: true, wallet: req.params.wallet, freeMode: true });
  }

  try {
    const { wallet } = req.params;

    const result = await pool.query(`
      SELECT * FROM payments
      WHERE wallet = $1
        AND status = 'active'
        AND expires_at > NOW()
      ORDER BY expires_at DESC
      LIMIT 1
    `, [wallet]);

    if (result.rows.length > 0) {
      const payment = result.rows[0];
      res.json({
        isPro: true,
        wallet: payment.wallet,
        expiresAt: payment.expires_at,
        paidAt: payment.paid_at,
        txSignature: payment.tx_signature,
      });
    } else {
      res.json({ isPro: false, wallet });
    }
  } catch (error) {
    console.error('Pro status check error:', error);
    // Fail open - if DB is down, return not Pro
    res.json({ isPro: false, wallet: req.params.wallet, error: 'Database unavailable' });
  }
});

// Record a payment
app.post('/api/payments', async (req, res) => {
  try {
    const { wallet, txSignature, amount, discountCode, isTrial } = req.body;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Handle free trial (7 days)
    if (isTrial) {
      // Check if wallet already used trial
      const existingTrial = await pool.query(
        'SELECT * FROM payments WHERE wallet = $1 AND discount_code = $2',
        [wallet, 'FREE_TRIAL']
      );

      if (existingTrial.rows.length > 0) {
        return res.status(400).json({ error: 'Free trial already used for this wallet' });
      }

      const trialExpiresAt = new Date();
      trialExpiresAt.setDate(trialExpiresAt.getDate() + 7); // 7-day trial

      const result = await pool.query(`
        INSERT INTO payments (wallet, tx_signature, amount, discount_code, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [wallet, txSignature, 0, 'FREE_TRIAL', trialExpiresAt]);

      return res.json({
        success: true,
        payment: result.rows[0],
        message: 'Free trial activated for 7 days',
      });
    }

    // Validate discount code if provided
    let finalAmount = amount || 1;
    if (discountCode && DISCOUNT_CODES[discountCode] !== undefined) {
      const discount = DISCOUNT_CODES[discountCode];
      finalAmount = finalAmount * (1 - discount / 100);
    }

    // For free (100% discount), txSignature can be the discount code
    if (finalAmount === 0 && !txSignature) {
      // Generate a unique signature for free activations
      const freeTxSignature = `FREE_${discountCode}_${Date.now()}`;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CONFIG.SUBSCRIPTION_DAYS);

      const result = await pool.query(`
        INSERT INTO payments (wallet, tx_signature, amount, discount_code, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [wallet, freeTxSignature, 0, discountCode, expiresAt]);

      return res.json({
        success: true,
        payment: result.rows[0],
        message: 'Pro activated with discount code',
      });
    }

    // For paid subscriptions, require txSignature
    if (!txSignature) {
      return res.status(400).json({ error: 'Transaction signature required' });
    }

    // TODO: Verify the transaction on-chain
    // This would involve checking the tx exists and transferred the correct amount

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CONFIG.SUBSCRIPTION_DAYS);

    const result = await pool.query(`
      INSERT INTO payments (wallet, tx_signature, amount, discount_code, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tx_signature) DO NOTHING
      RETURNING *
    `, [wallet, txSignature, finalAmount, discountCode || null, expiresAt]);

    if (result.rows.length === 0) {
      // Transaction already recorded
      return res.status(409).json({ error: 'Transaction already recorded' });
    }

    res.json({
      success: true,
      payment: result.rows[0],
      message: 'Pro activated successfully',
    });
  } catch (error) {
    console.error('Payment recording error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// Get payment history for a wallet
app.get('/api/payments/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    const result = await pool.query(`
      SELECT * FROM payments
      WHERE wallet = $1
      ORDER BY created_at DESC
    `, [wallet]);

    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Validate a discount code
app.get('/api/discount/:code', (req, res) => {
  const { code } = req.params;
  const discount = DISCOUNT_CODES[code];

  if (discount !== undefined) {
    res.json({ valid: true, discount, code });
  } else {
    res.json({ valid: false, code });
  }
});

// ============================================================================
// Users API - Create/update user on wallet connect
// ============================================================================

// Upsert user (called when wallet connects)
app.post('/api/users', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const result = await pool.query(`
      INSERT INTO users (wallet, last_seen_at)
      VALUES ($1, NOW())
      ON CONFLICT (wallet) DO UPDATE SET last_seen_at = NOW()
      RETURNING *
    `, [wallet]);

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User upsert error:', error);
    res.status(500).json({ error: 'Failed to create/update user' });
  }
});

// Get user info
app.get('/api/users/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    const result = await pool.query(`
      SELECT * FROM users WHERE wallet = $1
    `, [wallet]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ============================================================================
// Labels API - CRUD for wallet labels
// ============================================================================

// Get all labels for a wallet
app.get('/api/labels/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    const result = await pool.query(`
      SELECT * FROM labels
      WHERE owner_wallet = $1
      ORDER BY created_at DESC
    `, [wallet]);

    res.json({ labels: result.rows });
  } catch (error) {
    console.error('Get labels error:', error);
    res.status(500).json({ error: 'Failed to get labels' });
  }
});

// Create a new label (max 3 per wallet)
app.post('/api/labels', async (req, res) => {
  try {
    const { owner_wallet, name, color, wallets } = req.body;

    if (!owner_wallet || !name) {
      return res.status(400).json({ error: 'owner_wallet and name are required' });
    }

    // Check if user has active payment (paid users only)
    const paymentCheck = await pool.query(`
      SELECT * FROM payments
      WHERE wallet = $1
        AND status = 'active'
        AND expires_at > NOW()
      LIMIT 1
    `, [owner_wallet]);

    if (paymentCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'Labels are a Pro feature. Please upgrade to create labels.',
        code: 'PRO_REQUIRED'
      });
    }

    // Ensure user exists first
    await pool.query(`
      INSERT INTO users (wallet) VALUES ($1)
      ON CONFLICT (wallet) DO NOTHING
    `, [owner_wallet]);

    // Check label count (max 3)
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM labels WHERE owner_wallet = $1
    `, [owner_wallet]);

    if (parseInt(countResult.rows[0].count) >= 3) {
      return res.status(400).json({ error: 'Maximum 3 labels allowed per wallet' });
    }

    // Create the label
    const result = await pool.query(`
      INSERT INTO labels (owner_wallet, name, color, wallets)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [owner_wallet, name, color || '#00D18C', JSON.stringify(wallets || [])]);

    res.json({ success: true, label: result.rows[0] });
  } catch (error) {
    console.error('Create label error:', error);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

// Update a label (ownership verified, works even if payment expired)
app.put('/api/labels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { owner_wallet, name, color, wallets } = req.body;

    if (!owner_wallet) {
      return res.status(400).json({ error: 'owner_wallet required for verification' });
    }

    // Verify ownership
    const existing = await pool.query(`
      SELECT * FROM labels WHERE id = $1 AND owner_wallet = $2
    `, [id, owner_wallet]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found or not owned by this wallet' });
    }

    // Update the label
    const result = await pool.query(`
      UPDATE labels SET
        name = COALESCE($1, name),
        color = COALESCE($2, color),
        wallets = COALESCE($3, wallets),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [name, color, wallets ? JSON.stringify(wallets) : null, id]);

    res.json({ success: true, label: result.rows[0] });
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ error: 'Failed to update label' });
  }
});

// Delete a label
app.delete('/api/labels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { owner_wallet } = req.body;

    if (!owner_wallet) {
      return res.status(400).json({ error: 'owner_wallet required for verification' });
    }

    // Verify ownership and delete
    const result = await pool.query(`
      DELETE FROM labels
      WHERE id = $1 AND owner_wallet = $2
      RETURNING *
    `, [id, owner_wallet]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found or not owned by this wallet' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    console.error('Delete label error:', error);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// Search labels by name (for search box)
app.get('/api/labels/search/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { q } = req.query; // search query

    let query = `SELECT * FROM labels WHERE owner_wallet = $1`;
    const params = [wallet];

    if (q) {
      query += ` AND LOWER(name) LIKE LOWER($2)`;
      params.push(`%${q}%`);
    }

    query += ` ORDER BY name ASC`;

    const result = await pool.query(query, params);
    res.json({ labels: result.rows });
  } catch (error) {
    console.error('Search labels error:', error);
    res.status(500).json({ error: 'Failed to search labels' });
  }
});

// Get label history (snapshots)
app.get('/api/labels/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { days } = req.query; // optional: limit to last N days

    let query = `
      SELECT * FROM label_snapshots
      WHERE label_id = $1
    `;
    const params = [id];

    if (days) {
      query += ` AND snapshot_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'`;
    }

    query += ` ORDER BY snapshot_date DESC LIMIT 365`;

    const result = await pool.query(query, params);
    res.json({ history: result.rows });
  } catch (error) {
    console.error('Get label history error:', error);
    res.status(500).json({ error: 'Failed to get label history' });
  }
});

// Get aggregated portfolio for a label (live, not from snapshots)
app.get('/api/labels/:id/portfolio', async (req, res) => {
  try {
    const { id } = req.params;

    // Get the label
    const labelResult = await pool.query(`
      SELECT * FROM labels WHERE id = $1
    `, [id]);

    if (labelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }

    const label = labelResult.rows[0];
    const wallets = label.wallets || [];

    if (wallets.length === 0) {
      return res.json({
        label,
        portfolio: {
          totalNetWorth: 0,
          totalTokens: 0,
          defiDeposits: 0,
          defiBorrows: 0,
        },
        tokens: [],
        defiPositions: [],
      });
    }

    // Get wallet addresses from the JSONB array
    const walletAddresses = wallets.map(w => w.address);

    // Fetch portfolio data for all wallets
    const portfolios = await Promise.all(
      walletAddresses.map(async (wallet) => {
        try {
          const [holdings, defi] = await Promise.all([
            getTokenHoldings(wallet),
            getDefiPositionsFast(wallet),
          ]);
          return { wallet, holdings, defi };
        } catch (e) {
          console.error(`Error fetching portfolio for ${wallet}:`, e.message);
          return { wallet, holdings: { tokens: [], totalUsd: 0 }, defi: { positions: [], totalDeposits: 0, totalBorrows: 0 } };
        }
      })
    );

    // Aggregate results
    let totalTokens = 0;
    let defiDeposits = 0;
    let defiBorrows = 0;
    const allTokens = [];
    const allDefiPositions = [];

    for (const p of portfolios) {
      totalTokens += p.holdings.totalUsd || 0;
      defiDeposits += p.defi.totalDeposits || 0;
      defiBorrows += p.defi.totalBorrows || 0;

      const walletShort = p.wallet.slice(0, 4) + '...' + p.wallet.slice(-4);
      for (const t of p.holdings.tokens || []) {
        allTokens.push({ ...t, wallet: p.wallet, walletShort });
      }
      for (const d of p.defi.positions || []) {
        allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });
      }
    }

    const totalNetWorth = totalTokens + defiDeposits - defiBorrows;

    res.json({
      label,
      portfolio: {
        totalNetWorth,
        totalTokens,
        defiDeposits,
        defiBorrows,
      },
      tokens: allTokens.sort((a, b) => b.value - a.value),
      defiPositions: allDefiPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    });
  } catch (error) {
    console.error('Get label portfolio error:', error);
    res.status(500).json({ error: 'Failed to get label portfolio' });
  }
});

// ============================================================================
// Internal API - Daily snapshot cron (protected by secret)
// Called by GitHub Action or external cron to capture daily portfolio values
// ============================================================================

const SNAPSHOT_SECRET = process.env.SNAPSHOT_SECRET || 'snapshot_s3cr3t_2024';

app.post('/api/internal/snapshot', async (req, res) => {
  try {
    // Verify secret
    const providedSecret = req.query.secret || req.headers['x-snapshot-secret'];
    if (providedSecret !== SNAPSHOT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get labels that haven't been snapshotted in the last 24 hours
    // This spreads load when running hourly instead of processing all at once
    const labelsResult = await pool.query(`
      SELECT l.* FROM labels l
      WHERE l.wallets IS NOT NULL AND jsonb_array_length(l.wallets) > 0
        AND NOT EXISTS (
          SELECT 1 FROM label_snapshots s
          WHERE s.label_id = l.id
            AND s.created_at > NOW() - INTERVAL '24 hours'
        )
      ORDER BY l.updated_at ASC
      LIMIT 50
    `);

    const labels = labelsResult.rows;
    console.log(`📸 Taking snapshots for ${labels.length} stale labels (>24h since last snapshot)...`);

    const results = [];
    for (const label of labels) {
      try {
        const wallets = label.wallets || [];
        const walletAddresses = wallets.map(w => w.address);

        // Fetch portfolio data
        let totalTokens = 0;
        let defiDeposits = 0;
        let defiBorrows = 0;

        for (const wallet of walletAddresses) {
          try {
            const [holdings, defi] = await Promise.all([
              getTokenHoldings(wallet),
              getDefiPositionsFast(wallet),
            ]);
            totalTokens += holdings.totalUsd || 0;
            defiDeposits += defi.totalDeposits || 0;
            defiBorrows += defi.totalBorrows || 0;
          } catch (e) {
            console.error(`  Snapshot error for wallet ${wallet}:`, e.message);
          }
        }

        const totalNetWorth = totalTokens + defiDeposits - defiBorrows;

        // Insert or update snapshot for today
        await pool.query(`
          INSERT INTO label_snapshots (label_id, snapshot_date, total_net_worth, total_tokens, defi_deposits, defi_borrows, wallet_count)
          VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
          ON CONFLICT (label_id, snapshot_date)
          DO UPDATE SET
            total_net_worth = $2,
            total_tokens = $3,
            defi_deposits = $4,
            defi_borrows = $5,
            wallet_count = $6
        `, [label.id, totalNetWorth, totalTokens, defiDeposits, defiBorrows, walletAddresses.length]);

        results.push({
          label_id: label.id,
          name: label.name,
          net_worth: totalNetWorth,
          status: 'success',
        });
        console.log(`  ✓ ${label.name}: $${totalNetWorth.toFixed(2)}`);
      } catch (e) {
        results.push({
          label_id: label.id,
          name: label.name,
          status: 'error',
          error: e.message,
        });
        console.error(`  ✗ ${label.name}: ${e.message}`);
      }
    }

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      snapshots: results.length,
      results,
    });
  } catch (error) {
    console.error('Snapshot error:', error);
    res.status(500).json({ error: 'Failed to take snapshots' });
  }
});

// ============================================================================
// Metrics endpoint (protected by secret)
// Access: /api/metrics?secret=YOUR_METRICS_SECRET
// ============================================================================
const METRICS_SECRET = process.env.METRICS_SECRET || 'saul_metrics_2024';

app.get('/api/metrics', (req, res) => {
  // Check secret
  const providedSecret = req.query.secret || req.headers['x-metrics-secret'];
  if (providedSecret !== METRICS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Update cache sizes
  updateCacheSizes();

  // Calculate derived metrics
  const uptimeMs = Date.now() - metrics.startTime;
  const uptimeHours = (uptimeMs / 1000 / 60 / 60).toFixed(2);

  const cacheHitRate = metrics.cache.hits + metrics.cache.misses > 0
    ? ((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1)
    : 0;

  // Build API stats with percentiles
  const apiStats = {};
  for (const [provider, stats] of Object.entries(metrics.api)) {
    const avgLatency = stats.calls > 0 ? (stats.totalLatencyMs / stats.calls).toFixed(0) : 0;
    apiStats[provider] = {
      calls: stats.calls,
      errors: stats.errors,
      timeouts: stats.timeouts,
      errorRate: stats.calls > 0 ? ((stats.errors / stats.calls) * 100).toFixed(1) + '%' : '0%',
      avgLatencyMs: parseInt(avgLatency),
      p50LatencyMs: getPercentile(stats.latencies, 50),
      p95LatencyMs: getPercentile(stats.latencies, 95),
      p99LatencyMs: getPercentile(stats.latencies, 99),
    };
  }

  res.json({
    status: 'ok',
    uptime: `${uptimeHours} hours`,
    uptimeMs,

    cache: {
      hits: metrics.cache.hits,
      misses: metrics.cache.misses,
      hitRate: `${cacheHitRate}%`,
      walletsCached: {
        holdings: metrics.cache.holdings.size,
        lambdaDefi: metrics.cache.lambdaDefi.size,
        dialectDefi: metrics.cache.dialectDefi.size,
        pnl: metrics.cache.pnl.size,
      },
    },

    externalAPIs: apiStats,

    uniqueWalletsTracked: metrics.uniqueWallets.size,

    requests: metrics.requests,
  });
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
    GET  /api/payments/:wallet       - Get payment history
    GET  /api/discount/:code         - Validate discount code
`);
  });
});

