#!/usr/bin/env npx tsx
/**
 * Creates wallet_pnl_fifo table with FIFO-based P&L calculations INCLUDING settlement P&L.
 *
 * BATCHED VERSION with SETTLEMENT P&L: Processes wallets incrementally.
 *
 * Usage:
 *   npx tsx scripts/105-create-fifo-pnl-with-settlements.ts [--drop] [--batch-size 100]
 *
 * Flags:
 *   --drop: Drop existing table first
 *   --batch-size: Number of wallets to process per batch (default: 100)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const DROP_EXISTING = process.argv.includes('--drop');
const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '100');

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

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
}

interface PositionResult {
  wallet: string;
  cid: string;
  outcome_idx: number;
  realized_pnl: number;
  settlement_pnl: number;
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
        // Silently skip for batch processing
      }
    }
  }

  const unrealized_shares = inventory.reduce((s, lot) => s + lot.qty, 0);
  const unrealized_cost = inventory.reduce((s, lot) => s + (lot.qty * lot.costPerShare), 0);

  return { realized_pnl, unrealized_shares, unrealized_cost };
}

async function getAllWallets(): Promise<string[]> {
  console.log('Fetching wallet list...');
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(wallet_address) AS wallet
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
      ORDER BY wallet
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json<{ wallet: string }[]>();
  console.log(`Found ${rows.length.toLocaleString()} wallets`);
  return rows.map(r => r.wallet);
}

async function fetchTradesForWallets(wallets: string[]): Promise<Map<string, Trade[]>> {
  const walletList = wallets.map(w => `'${w}'`).join(',');

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
    WHERE lower(wallet_address) IN (${walletList})
      AND condition_id_norm_v3 != ''
    ORDER BY wallet, cid, outcome_idx, ts
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = await result.json<Trade[]>();

  // Group by wallet::cid::outcome
  const grouped = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${t.wallet}::${t.cid}::${t.outcome_idx}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  return grouped;
}

async function fetchResolutionsForConditions(conditionIds: string[]): Promise<Map<string, Resolution>> {
  if (conditionIds.length === 0) return new Map();

  const cidList = conditionIds.map(c => `'${c}'`).join(',');

  const query = `
    SELECT
      lower(condition_id_norm) AS condition_id,
      payout_numerators,
      payout_denominator
    FROM market_resolutions_final
    WHERE lower(condition_id_norm) IN (${cidList})
      AND payout_denominator > 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<Resolution[]>();

  const resolutionMap = new Map<string, Resolution>();
  for (const r of rows) {
    resolutionMap.set(r.condition_id, r);
  }

  return resolutionMap;
}

async function computeFIFOResults(
  grouped: Map<string, Trade[]>,
  resolutions: Map<string, Resolution>
): Promise<PositionResult[]> {
  const results: PositionResult[] = [];

  for (const [key, trades] of grouped.entries()) {
    const [wallet, cid, outcome_idx_str] = key.split('::');
    const outcome_idx = parseInt(outcome_idx_str);

    const { realized_pnl, unrealized_shares, unrealized_cost } = calculateFIFO(trades);
    const volume = trades.reduce((s, t) => s + t.usd, 0);
    const fills = trades.length;

    // Calculate settlement P&L
    let settlement_pnl = 0;
    const resolution = resolutions.get(cid);

    if (resolution && unrealized_shares > 0) {
      // ClickHouse arrays are 1-indexed
      const payout_numerator = resolution.payout_numerators[outcome_idx + 1] || 0;
      const payout_per_share = payout_numerator / resolution.payout_denominator;
      const settlement_value = unrealized_shares * payout_per_share;
      settlement_pnl = settlement_value - unrealized_cost;
    } else if (unrealized_shares > 0) {
      // No resolution data - can't calculate settlement P&L
      // Leave as 0 (conservative: assume position has no value)
      settlement_pnl = 0;
    }

    results.push({
      wallet,
      cid,
      outcome_idx,
      realized_pnl,
      settlement_pnl,
      unrealized_shares,
      unrealized_cost,
      fills,
      volume
    });
  }

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
      settlement_pnl Float64,
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
  if (results.length === 0) return;

  const values = results.map(r =>
    `('${r.wallet}', '${r.cid}', ${r.outcome_idx}, ${r.realized_pnl}, ${r.settlement_pnl}, ${r.unrealized_shares}, ${r.unrealized_cost}, ${r.fills}, ${r.volume})`
  ).join(',');

  const insertSQL = `
    INSERT INTO wallet_pnl_fifo
    (wallet, condition_id, outcome_index, realized_pnl, settlement_pnl, unrealized_shares, unrealized_cost, fills, volume)
    VALUES ${values}
  `;

  await clickhouse.query({ query: insertSQL });
}

async function createAggregateView() {
  console.log('\nCreating wallet_pnl_summary view...');

  await clickhouse.query({ query: 'DROP VIEW IF EXISTS wallet_pnl_summary' });

  const viewSQL = `
    CREATE VIEW wallet_pnl_summary AS
    SELECT
      wallet,
      sum(realized_pnl) AS total_realized_pnl,
      sum(settlement_pnl) AS total_settlement_pnl,
      sum(realized_pnl + settlement_pnl) AS total_pnl,
      sumIf(realized_pnl, realized_pnl > 0) AS total_trading_gains,
      -sumIf(realized_pnl, realized_pnl < 0) AS total_trading_losses,
      sumIf(settlement_pnl, settlement_pnl > 0) AS total_settlement_gains,
      -sumIf(settlement_pnl, settlement_pnl < 0) AS total_settlement_losses,
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
  console.log('VALIDATION - Top 5 Wallets by Total P&L');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const query = `
    SELECT
      wallet,
      total_pnl,
      total_realized_pnl,
      total_settlement_pnl,
      total_volume,
      total_positions,
      total_fills
    FROM wallet_pnl_summary
    ORDER BY abs(total_pnl) DESC
    LIMIT 5
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json<any[]>();

  wallets.forEach((w, i) => {
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   Total P&L:      $${parseFloat(w.total_pnl).toLocaleString()}`);
    console.log(`   Trading P&L:    $${parseFloat(w.total_realized_pnl).toLocaleString()}`);
    console.log(`   Settlement P&L: $${parseFloat(w.total_settlement_pnl).toLocaleString()}`);
    console.log(`   Volume:         $${parseFloat(w.total_volume).toLocaleString()}`);
    console.log(`   Positions:      ${parseInt(w.total_positions)}`);
    console.log(`   Fills:          ${parseInt(w.total_fills)}`);
    console.log('');
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FIFO P&L TABLE BUILDER (with Settlement P&L)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Batch size: ${BATCH_SIZE} wallets`);
  console.log(`Drop existing: ${DROP_EXISTING ? 'YES' : 'NO'}`);
  console.log('');

  try {
    // Step 1: Create table
    await createTable();

    // Step 2: Get all wallets
    const allWallets = await getAllWallets();
    const totalBatches = Math.ceil(allWallets.length / BATCH_SIZE);

    console.log(`\nProcessing ${allWallets.length.toLocaleString()} wallets in ${totalBatches.toLocaleString()} batches...\n`);

    // Step 3: Process wallets in batches
    for (let i = 0; i < allWallets.length; i += BATCH_SIZE) {
      const batch = allWallets.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`[Batch ${batchNum}/${totalBatches}] Processing ${batch.length} wallets...`);

      // Fetch trades for this batch
      const grouped = await fetchTradesForWallets(batch);
      console.log(`  Loaded ${grouped.size.toLocaleString()} positions`);

      // Get unique condition_ids for resolution lookup
      const conditionIds = Array.from(new Set(
        Array.from(grouped.keys()).map(key => key.split('::')[1])
      ));

      // Fetch resolutions for these conditions
      const resolutions = await fetchResolutionsForConditions(conditionIds);
      console.log(`  Found ${resolutions.size.toLocaleString()} resolutions`);

      // Compute FIFO with settlements
      const results = await computeFIFOResults(grouped, resolutions);
      console.log(`  Computed FIFO + settlements for ${results.length.toLocaleString()} positions`);

      // Insert results
      await insertResults(results);
      console.log(`  ✓ Inserted to database`);
      console.log('');
    }

    console.log('✓ All batches processed');

    // Step 4: Create summary view
    await createAggregateView();

    // Step 5: Validate
    await validateResults();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✓ COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\nUsage:');
    console.log('  -- Get P&L for a specific wallet:');
    console.log("  SELECT * FROM wallet_pnl_summary WHERE wallet = '0x...'");
    console.log('');
    console.log('  -- Get top 10 wallets by total P&L:');
    console.log('  SELECT * FROM wallet_pnl_summary ORDER BY total_pnl DESC LIMIT 10');
    console.log('');
    console.log('  -- Get position details for a wallet:');
    console.log("  SELECT * FROM wallet_pnl_fifo WHERE wallet = '0x...' ORDER BY abs(realized_pnl + settlement_pnl) DESC");

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  }
}

main().catch(console.error);
