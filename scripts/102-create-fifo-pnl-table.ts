#!/usr/bin/env npx tsx
/**
 * Creates wallet_pnl_fifo table with FIFO-based P&L calculations for all wallets.
 *
 * This replaces the simple aggregation method with proper inventory tracking,
 * eliminating phantom profits from intra-market trading churn.
 *
 * Usage:
 *   npx tsx scripts/102-create-fifo-pnl-table.ts [--drop] [--test]
 *
 * Flags:
 *   --drop: Drop existing table first
 *   --test: Only test on a few wallets, don't create full table
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const DROP_EXISTING = process.argv.includes('--drop');
const TEST_MODE = process.argv.includes('--test');

interface Trade {
  wallet: string;
  cid: string;
  outcome_idx: number;
  direction: 'BUY' | 'SELL';
  shares: number;
  usd: number;
  fee: number;
  ts: number;
}

interface PositionResult {
  wallet: string;
  cid: string;
  outcome_idx: number;
  realized_pnl: number;
  unrealized_shares: number;
  unrealized_cost: number;
  fills: number;
  volume: number;
}

function calculateFIFO(trades: Trade[]): { realized_pnl: number; unrealized_shares: number; unrealized_cost: number } {
  interface Lot { qty: number; costPerShare: number }
  const inventory: Lot[] = [];
  let realized_pnl = 0;

  for (const t of trades) {
    if (t.direction === 'BUY') {
      const effectiveCost = t.usd + t.fee;
      const costPerShare = t.shares > 0 ? effectiveCost / t.shares : 0;
      inventory.push({ qty: t.shares, costPerShare });
    } else {
      // SELL
      const effectiveProceeds = t.usd - t.fee;
      const proceedsPerShare = t.shares > 0 ? effectiveProceeds / t.shares : 0;
      let remaining = t.shares;

      while (remaining > 0 && inventory.length > 0) {
        const lot = inventory[0];
        const sold = Math.min(remaining, lot.qty);
        realized_pnl += sold * (proceedsPerShare - lot.costPerShare);
        remaining -= sold;
        lot.qty -= sold;
        if (lot.qty === 0) inventory.shift();
      }

      // If trying to sell more than inventory, skip (short selling not supported)
      if (remaining > 0) {
        console.warn(`  Warning: Attempted to sell ${remaining} shares without inventory`);
      }
    }
  }

  const unrealized_shares = inventory.reduce((s, lot) => s + lot.qty, 0);
  const unrealized_cost = inventory.reduce((s, lot) => s + (lot.qty * lot.costPerShare), 0);

  return { realized_pnl, unrealized_shares, unrealized_cost };
}

async function fetchAllTrades(walletFilter?: string): Promise<Map<string, Trade[]>> {
  console.log('Fetching trades from database...');

  const where = walletFilter
    ? `lower(wallet_address) = lower('${walletFilter}') AND condition_id_norm_v3 != ''`
    : `condition_id_norm_v3 != ''`;

  const query = `
    SELECT
      lower(wallet_address) AS wallet,
      lower(condition_id_norm_v3) AS cid,
      toInt8(outcome_index_v3) AS outcome_idx,
      trade_direction AS direction,
      toFloat64(shares) AS shares,
      toFloat64(usd_value) AS usd,
      toFloat64(fee) AS fee,
      toUInt32(timestamp) AS ts
    FROM pm_trades_canonical_v3
    WHERE ${where}
    ORDER BY wallet, cid, outcome_idx, ts
    ${TEST_MODE ? 'LIMIT 10000' : ''}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = await result.json<Trade[]>();

  console.log(`Loaded ${trades.length.toLocaleString()} trades`);

  // Group by wallet::cid::outcome
  const grouped = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${t.wallet}::${t.cid}::${t.outcome_idx}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  console.log(`Grouped into ${grouped.size.toLocaleString()} positions`);
  return grouped;
}

async function computeFIFOResults(grouped: Map<string, Trade[]>): Promise<PositionResult[]> {
  console.log('Computing FIFO P&L for each position...');

  const results: PositionResult[] = [];
  let processed = 0;

  for (const [key, trades] of grouped.entries()) {
    const [wallet, cid, outcome_idx_str] = key.split('::');
    const outcome_idx = parseInt(outcome_idx_str);

    const { realized_pnl, unrealized_shares, unrealized_cost } = calculateFIFO(trades);
    const volume = trades.reduce((s, t) => s + t.usd, 0);
    const fills = trades.length;

    results.push({
      wallet,
      cid,
      outcome_idx,
      realized_pnl,
      unrealized_shares,
      unrealized_cost,
      fills,
      volume
    });

    processed++;
    if (processed % 10000 === 0) {
      console.log(`  Processed ${processed.toLocaleString()} / ${grouped.size.toLocaleString()} positions...`);
    }
  }

  console.log(`✓ Computed FIFO for ${results.length.toLocaleString()} positions`);
  return results;
}

async function createTable() {
  console.log('\nCreating wallet_pnl_fifo table...');

  if (DROP_EXISTING) {
    console.log('Dropping existing table...');
    await clickhouse.query({ query: 'DROP TABLE IF EXISTS wallet_pnl_fifo' });
  }

  const createSQL = `
    CREATE TABLE IF NOT EXISTS wallet_pnl_fifo (
      wallet String,
      condition_id String,
      outcome_index Int8,
      realized_pnl Float64,
      unrealized_shares Float64,
      unrealized_cost Float64,
      fills UInt32,
      volume Float64,
      updated_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (wallet, condition_id, outcome_index)
  `;

  await clickhouse.query({ query: createSQL });
  console.log('✓ Table created');
}

async function insertResults(results: PositionResult[]) {
  console.log(`\nInserting ${results.length.toLocaleString()} positions...`);

  const BATCH_SIZE = 10000;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);

    const values = batch.map(r =>
      `('${r.wallet}', '${r.cid}', ${r.outcome_idx}, ${r.realized_pnl}, ${r.unrealized_shares}, ${r.unrealized_cost}, ${r.fills}, ${r.volume})`
    ).join(',');

    const insertSQL = `
      INSERT INTO wallet_pnl_fifo
      (wallet, condition_id, outcome_index, realized_pnl, unrealized_shares, unrealized_cost, fills, volume)
      VALUES ${values}
    `;

    await clickhouse.query({ query: insertSQL });
    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(results.length / BATCH_SIZE)}`);
  }

  console.log('✓ All data inserted');
}

async function createAggregateView() {
  console.log('\nCreating wallet_pnl_summary view...');

  await clickhouse.query({ query: 'DROP VIEW IF EXISTS wallet_pnl_summary' });

  const viewSQL = `
    CREATE VIEW wallet_pnl_summary AS
    SELECT
      wallet,
      sum(realized_pnl) AS total_realized_pnl,
      sumIf(realized_pnl, realized_pnl > 0) AS total_gains,
      -sumIf(realized_pnl, realized_pnl < 0) AS total_losses,
      sum(unrealized_shares) AS total_unrealized_shares,
      sum(unrealized_cost) AS total_unrealized_cost,
      sum(fills) AS total_fills,
      sum(volume) AS total_volume,
      count() AS total_positions
    FROM wallet_pnl_fifo
    GROUP BY wallet
  `;

  await clickhouse.query({ query: viewSQL });
  console.log('✓ View created');
}

async function validateResults() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('VALIDATION - Top 5 Wallets by P&L');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const query = `
    SELECT
      wallet,
      total_realized_pnl,
      total_gains,
      total_losses,
      total_volume,
      total_positions,
      total_fills
    FROM wallet_pnl_summary
    ORDER BY abs(total_realized_pnl) DESC
    LIMIT 5
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json<any[]>();

  wallets.forEach((w, i) => {
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   P&L:       $${parseFloat(w.total_realized_pnl).toLocaleString()}`);
    console.log(`   Gains:     $${parseFloat(w.total_gains).toLocaleString()}`);
    console.log(`   Losses:    $${parseFloat(w.total_losses).toLocaleString()}`);
    console.log(`   Volume:    $${parseFloat(w.total_volume).toLocaleString()}`);
    console.log(`   Positions: ${parseInt(w.total_positions)}`);
    console.log(`   Fills:     ${parseInt(w.total_fills)}`);
    console.log('');
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FIFO P&L TABLE BUILDER');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${TEST_MODE ? 'TEST (limited data)' : 'PRODUCTION (all wallets)'}`);
  console.log(`Drop existing: ${DROP_EXISTING ? 'YES' : 'NO'}`);
  console.log('');

  try {
    // Step 1: Fetch all trades
    const grouped = await fetchAllTrades();

    // Step 2: Compute FIFO P&L
    const results = await computeFIFOResults(grouped);

    // Step 3: Create table
    await createTable();

    // Step 4: Insert results
    await insertResults(results);

    // Step 5: Create summary view
    await createAggregateView();

    // Step 6: Validate
    await validateResults();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\nUsage:');
    console.log('  -- Get P&L for a specific wallet:');
    console.log("  SELECT * FROM wallet_pnl_summary WHERE wallet = '0x...'");
    console.log('');
    console.log('  -- Get top 10 wallets by P&L:');
    console.log('  SELECT * FROM wallet_pnl_summary ORDER BY total_realized_pnl DESC LIMIT 10');
    console.log('');
    console.log('  -- Get position details for a wallet:');
    console.log("  SELECT * FROM wallet_pnl_fifo WHERE wallet = '0x...' ORDER BY abs(realized_pnl) DESC");

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  }
}

main().catch(console.error);
