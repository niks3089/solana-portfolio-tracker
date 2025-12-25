import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/portfolio_dashboard';

async function initDb() {
    const pool = new Pool({ connectionString: DATABASE_URL });

    try {
        console.log('Connecting to database...');

        // Create payments table
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
    `);
        console.log('✓ Created payments table');

        // Create index on wallet for fast lookups
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_wallet ON payments(wallet);
    `);
        console.log('✓ Created wallet index');

        // Create index on expires_at for expiration queries
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at);
    `);
        console.log('✓ Created expires_at index');

        // Create index on status
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    `);
        console.log('✓ Created status index');

        console.log('\n✅ Database initialized successfully!');
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDb();

