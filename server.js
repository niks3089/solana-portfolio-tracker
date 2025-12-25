/**
 * Portfolio Dashboard Server
 * Minimal backend for multi-wallet portfolio tracking
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Config
const CONFIG = {
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || 'e4303524dbf9450188bc9d92e1d21b72',
  DIALECT_API_KEY: process.env.DIALECT_API_KEY || 'sk_usjjgv83q3jrlvqg2fwilsi7',
  LAMBDA_P2P_API_KEY: process.env.LAMBDA_P2P_API_KEY || 'feMLcQShh5WNpbgE4zgAAz3iWDAzvoCL',
  PAYMENT_WALLET: process.env.PAYMENT_WALLET || '2P2QaYCyjXiSqygKxrN4mREnTENTL4oQ64kN5nx4XPaX',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/portfolio_dashboard',
  PORT: process.env.PORT || 3000,
  SUBSCRIPTION_DAYS: 30,
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        wallet VARCHAR(64) NOT NULL,
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
    console.log('✓ Database tables initialized');
  } catch (error) {
    console.error('⚠ Database initialization skipped (will work without persistence):', error.message);
  }
}

// ============================================================================
// API Helpers
// ============================================================================

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'accept': 'application/json', ...options.headers },
  });
  return response.json();
}

// Native SOL address needs to be mapped to Wrapped SOL for P&L lookup
const NATIVE_SOL = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

// Get token holdings from Birdeye
async function getTokenHoldings(wallet) {
  const data = await fetchJSON(
    `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
    { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
  );

  if (!data.success) return { tokens: [], totalUsd: 0 };

  return {
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
}

// Get P&L for a token
async function getTokenPnL(tokenAddress, wallet) {
  try {
    const data = await fetchJSON(
      `https://public-api.birdeye.so/wallet/v2/pnl/multiple?token_address=${tokenAddress}&wallets=${wallet}`,
      { headers: { 'x-chain': 'solana', 'X-API-KEY': CONFIG.BIRDEYE_API_KEY } }
    );

    if (!data.data?.data?.[wallet]) return null;

    const d = data.data.data[wallet];
    return {
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
  } catch (e) {
    return null;
  }
}

// Get DeFi positions from Dialect
async function getDialectPositions(wallet) {
  try {
    const data = await fetchJSON(
      `https://markets.dial.to/api/v0/positions/owners?walletAddresses=${wallet}`,
      { headers: { 'x-dialect-api-key': CONFIG.DIALECT_API_KEY } }
    );
    if (!data.positions) return [];

    return data.positions.map(pos => ({
      protocol: pos.market?.provider?.name || 'Unknown',
      protocolIcon: pos.market?.provider?.icon,
      token: pos.market?.token?.symbol,
      tokenIcon: pos.market?.token?.icon,
      type: pos.side || pos.type || 'deposit',
      amount: pos.amount || 0,
      value: pos.amountUsd || 0,
      apy: (pos.market?.depositApy || pos.market?.borrowApy || 0) * 100,
      source: 'dialect',
    }));
  } catch (e) {
    console.error('Dialect error:', e.message);
    return [];
  }
}

// Get DeFi positions from Lambda P2P (covers Drift, etc.)
async function getLambdaPositions(wallet) {
  try {
    const data = await fetchJSON(
      `https://api.lambda.p2p.org/api/v1/chains/solana/wallets/${wallet}/balances`,
      { headers: { 'Authorization': CONFIG.LAMBDA_P2P_API_KEY } }
    );

    if (!data.data?.assets) return [];

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
    return positions;
  } catch (e) {
    console.error('Lambda P2P error:', e.message);
    return [];
  }
}

// Get combined DeFi positions
async function getDefiPositions(wallet) {
  const [dialectPos, lambdaPos] = await Promise.all([
    getDialectPositions(wallet),
    getLambdaPositions(wallet),
  ]);

  // Deduplicate: Lambda positions for protocols not in Dialect
  const dialectProtocols = new Set(dialectPos.map(p => p.protocol.toLowerCase()));
  const uniqueLambdaPos = lambdaPos.filter(p => !dialectProtocols.has(p.protocol.toLowerCase()));

  const allPositions = [...dialectPos, ...uniqueLambdaPos];

  let totalDeposits = 0;
  let totalBorrows = 0;

  for (const pos of allPositions) {
    if (pos.type === 'borrow') totalBorrows += pos.value;
    else totalDeposits += pos.value;
  }

  return {
    positions: allPositions.sort((a, b) => b.value - a.value),
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

// Get full portfolio for a wallet
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

// Get aggregated portfolio for multiple wallets
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
      if (p.error) continue;

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
  });
});

// ============================================================================
// Payment & Subscription API
// ============================================================================

// Check Pro status for a wallet
app.get('/api/pro-status/:wallet', async (req, res) => {
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

