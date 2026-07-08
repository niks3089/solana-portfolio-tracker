function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required environment variable: ${name}`);
    return v;
}

function optional(name: string, fallback = ''): string {
    return process.env[name] || fallback;
}

export const CONFIG = {
    BIRDEYE_API_KEY: required('BIRDEYE_API_KEY'),
    HELIUS_API_KEY: required('HELIUS_API_KEY'),
    LAMBDA_P2P_API_KEY: required('LAMBDA_P2P_API_KEY'),
    DIALECT_API_KEY: required('DIALECT_API_KEY'),

    METRICS_SECRET: required('METRICS_SECRET'),
    JWT_SECRET: required('JWT_SECRET'),

    TELEGRAM_BOT_TOKEN: optional('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_CHAT_ID: optional('TELEGRAM_CHAT_ID'),

    PORT: Number(optional('PORT', '3000')),

    TURNSTILE_SITE_KEY: (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SITE_KEY !== 'disabled')
        ? process.env.TURNSTILE_SITE_KEY : null,
    TURNSTILE_SECRET_KEY: (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SECRET_KEY !== 'disabled')
        ? process.env.TURNSTILE_SECRET_KEY : null,
} as const;

export const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;
