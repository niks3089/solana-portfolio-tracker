/**
 * Database Connection and Schema Initialization
 */

import pg from 'pg';
import { CONFIG } from './config.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: CONFIG.DATABASE_URL });

export async function initDatabase() {
    try {
        // Users table - central user identity (wallet as primary key)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        wallet VARCHAR(64) PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

        // Payments table - tracks subscriptions
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

        // Labels table - wallet groupings
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

        // Label snapshots - historical portfolio data
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

        // Alert settings - notification preferences
        await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        id SERIAL PRIMARY KEY,
        owner_wallet VARCHAR(64) NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
        label_id INTEGER REFERENCES labels(id) ON DELETE CASCADE,
        target_wallet VARCHAR(64),
        telegram_username VARCHAR(100),
        alert_type VARCHAR(20) DEFAULT 'any_tx',
        enabled BOOLEAN DEFAULT false,
        threshold_percent DECIMAL(5, 2) DEFAULT 5.00,
        last_known_value DECIMAL(20, 2) DEFAULT 0,
        last_notified_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_owner ON alert_settings(owner_wallet);
      CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alert_settings(enabled) WHERE enabled = true;
    `);

        console.log('✓ Database tables initialized');
    } catch (error) {
        console.error('⚠ Database initialization skipped:', error.message);
    }
}

