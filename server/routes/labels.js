/**
 * Labels (Portfolios) API Routes
 */

import { Router } from 'express';
import { pool } from '../db.js';
import { getHoldings, getDefiPositionsFast } from '../services/portfolio.js';

const router = Router();

// Get all labels for a wallet
router.get('/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const result = await pool.query(
            `SELECT * FROM labels WHERE owner_wallet = $1 ORDER BY created_at DESC`,
            [wallet]
        );
        res.json({ labels: result.rows });
    } catch (error) {
        console.error('Get labels error:', error);
        res.status(500).json({ error: 'Failed to get labels' });
    }
});

// Create a new label (max 3 per wallet)
router.post('/', async (req, res) => {
    try {
        const { owner_wallet, name, color, wallets } = req.body;

        if (!owner_wallet || !name) {
            return res.status(400).json({ error: 'owner_wallet and name required' });
        }

        // Ensure user exists
        await pool.query(
            `INSERT INTO users (wallet) VALUES ($1) ON CONFLICT (wallet) DO UPDATE SET last_seen_at = NOW()`,
            [owner_wallet]
        );

        // Check label count
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM labels WHERE owner_wallet = $1',
            [owner_wallet]
        );
        if (parseInt(countResult.rows[0].count) >= 3) {
            return res.status(400).json({ error: 'Maximum 3 labels per wallet' });
        }

        const result = await pool.query(
            `INSERT INTO labels (owner_wallet, name, color, wallets)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
            [owner_wallet, name, color || '#00D18C', JSON.stringify(wallets || [])]
        );

        res.json({ success: true, label: result.rows[0] });
    } catch (error) {
        console.error('Create label error:', error);
        res.status(500).json({ error: 'Failed to create label' });
    }
});

// Update a label
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { owner_wallet, name, color, wallets } = req.body;

        // Verify ownership
        const existing = await pool.query('SELECT * FROM labels WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Label not found' });
        }
        if (existing.rows[0].owner_wallet !== owner_wallet) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const result = await pool.query(
            `UPDATE labels
       SET name = COALESCE($1, name),
           color = COALESCE($2, color),
           wallets = COALESCE($3, wallets),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
            [name, color, wallets ? JSON.stringify(wallets) : null, id]
        );

        res.json({ success: true, label: result.rows[0] });
    } catch (error) {
        console.error('Update label error:', error);
        res.status(500).json({ error: 'Failed to update label' });
    }
});

// Delete a label
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { owner_wallet } = req.body;

        // Verify ownership
        const existing = await pool.query('SELECT * FROM labels WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Label not found' });
        }
        if (existing.rows[0].owner_wallet !== owner_wallet) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await pool.query('DELETE FROM labels WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete label error:', error);
        res.status(500).json({ error: 'Failed to delete label' });
    }
});

// Search labels
router.get('/search/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const { q } = req.query;

        let query = 'SELECT * FROM labels WHERE owner_wallet = $1';
        const params = [wallet];

        if (q) {
            query += ' AND LOWER(name) LIKE $2';
            params.push(`%${q.toLowerCase()}%`);
        }

        query += ' ORDER BY name';
        const result = await pool.query(query, params);
        res.json({ labels: result.rows });
    } catch (error) {
        console.error('Search labels error:', error);
        res.status(500).json({ error: 'Failed to search labels' });
    }
});

// Get label history (snapshots)
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const { days } = req.query;

        let query = `
      SELECT * FROM label_snapshots
      WHERE label_id = $1
      ORDER BY snapshot_date DESC
    `;
        const params = [id];

        if (days) {
            query = `
        SELECT * FROM label_snapshots
        WHERE label_id = $1 AND snapshot_date >= CURRENT_DATE - $2::interval
        ORDER BY snapshot_date DESC
      `;
            params.push(`${days} days`);
        }

        const result = await pool.query(query, params);
        res.json({ history: result.rows });
    } catch (error) {
        console.error('Get label history error:', error);
        res.status(500).json({ error: 'Failed to get history' });
    }
});

// Get aggregated portfolio for a label (live)
router.get('/:id/portfolio', async (req, res) => {
    try {
        const { id } = req.params;

        const labelResult = await pool.query('SELECT * FROM labels WHERE id = $1', [id]);
        if (labelResult.rows.length === 0) {
            return res.status(404).json({ error: 'Label not found' });
        }

        const label = labelResult.rows[0];
        const wallets = label.wallets || [];

        if (wallets.length === 0) {
            return res.json({
                label,
                portfolio: { totalAssets: 0, totalNetWorth: 0, totalTokens: 0, defiDeposits: 0, defiBorrows: 0 },
                tokens: [],
                defiPositions: [],
            });
        }

        // Fetch all wallet portfolios
        const portfolios = await Promise.all(
            wallets.map(async (w) => {
                try {
                    const [holdings, defi] = await Promise.all([
                        getHoldings(w.address),
                        getDefiPositionsFast(w.address),
                    ]);
                    return { wallet: w.address, name: w.name, holdings, defi };
                } catch (e) {
                    return { wallet: w.address, name: w.name, error: e.message };
                }
            })
        );

        // Aggregate
        let totalTokens = 0;
        let defiDeposits = 0;
        let defiBorrows = 0;
        const allTokens = [];
        const allDefiPositions = [];

        for (const p of portfolios) {
            if (p.error || !p.holdings) continue;

            const walletShort = `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`;
            totalTokens += p.holdings.totalValue || 0;
            defiDeposits += p.defi?.totalDeposits || 0;
            defiBorrows += p.defi?.totalBorrows || 0;

            for (const t of p.holdings.tokens || []) {
                allTokens.push({ ...t, wallet: p.wallet, walletShort });
            }
            for (const d of p.defi?.positions || []) {
                allDefiPositions.push({ ...d, wallet: p.wallet, walletShort });
            }
        }

        const totalAssets = totalTokens + defiDeposits;
        const totalNetWorth = totalAssets - defiBorrows;

        res.json({
            label,
            portfolio: { totalAssets, totalNetWorth, totalTokens, defiDeposits, defiBorrows },
            tokens: allTokens.sort((a, b) => b.value - a.value),
            defiPositions: allDefiPositions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        });
    } catch (error) {
        console.error('Get label portfolio error:', error);
        res.status(500).json({ error: 'Failed to get label portfolio' });
    }
});

export default router;

