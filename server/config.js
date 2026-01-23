/**
 * Application Configuration
 */

export const CONFIG = {
    BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || 'e4303524dbf9450188bc9d92e1d21b72',
    DIALECT_API_KEY: process.env.DIALECT_API_KEY || 'sk_usjjgv83q3jrlvqg2fwilsi7',
    DIALECT_PRIVATE_KEY: process.env.DIALECT_PRIVATE_KEY || 'ygzpwbLhh3KDUWXEtxu5mY3LD1wrYdpcj6bSmXkmyCiCFhRXXbJgZDdHthff4ikcTskBr9WPp3UantvzXm4cx4y',
    LAMBDA_P2P_API_KEY: process.env.LAMBDA_P2P_API_KEY || 'feMLcQShh5WNpbgE4zgAAz3iWDAzvoCL',
    HELIUS_API_KEY: process.env.HELIUS_API_KEY || 'ed2c2720-f40d-44d0-83be-ee7f3b8d5359',
    PAYMENT_WALLET: process.env.PAYMENT_WALLET || '2P2QaYCyjXiSqygKxrN4mREnTENTL4oQ64kN5nx4XPaX',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/portfolio_dashboard',
    PORT: process.env.PORT || 3000,
    SUBSCRIPTION_DAYS: 30,
    SNAPSHOT_SECRET: process.env.SNAPSHOT_SECRET || 'snapshot_s3cr3t_2024',
    METRICS_SECRET: process.env.METRICS_SECRET || 'metrics_s3cr3t_2024',
    // Free mode - everything unlocked, no wallet connection required
    FREE_MODE: process.env.FREE_MODE === 'true',
    // Cloudflare Turnstile (invisible bot protection) - set to empty string or 'disabled' to disable
    TURNSTILE_SITE_KEY: (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SITE_KEY !== 'disabled') ? process.env.TURNSTILE_SITE_KEY : null,
    TURNSTILE_SECRET_KEY: (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SECRET_KEY !== 'disabled') ? process.env.TURNSTILE_SECRET_KEY : null,
};

export const DISCOUNT_CODES = {
    'samay123': 100, // 100% off (free)
    'HELIUS50': 50,  // 50% off
};

export const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;
export const HELIUS_WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;

