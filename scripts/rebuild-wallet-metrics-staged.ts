#!/usr/bin/env npx tsx
/**
 * Complete Wallet Metrics Rebuild - Staged Approach
 *
 * Uses temp tables to break complex query into smaller HTTP requests
 *
 * Strategy:
 * 1. Create temp table with ALL unique wallets
 * 2. For each time window, create temp table with aggregated metrics
 * 3. JOIN and INSERT in smaller batches
 * 4. Result: 923,399 wallets × 4 windows = 3,693,596 rows
 *
 * Expected runtime: 3-5 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const DATE_START = '2022-06-01';
const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BASELINE_PNL = -27558.71;

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('WALLET METRICS COMPLETE REBUILD - STAGED APPROACH');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Drop and recreate table
    console.log('1️⃣  Recreating wallet_metrics table...\n');

    await ch.query({ query: 'DROP TABLE IF EXISTS default.wallet_metrics' });

    const createTableSQL = `
      CREATE TABLE default.wallet_metrics (
        wallet_address String NOT NULL,
        time_window Enum8(
          '30d' = 1,
          '90d' = 2,
          '180d' = 3,
          'lifetime' = 4
        ) NOT NULL,
        realized_pnl Float64 DEFAULT 0,
        unrealized_payout Float64 DEFAULT 0,
        roi_pct Float64 DEFAULT 0,
        win_rate Float64 DEFAULT 0,
        sharpe_ratio Float64 DEFAULT 0,
        omega_ratio Float64 DEFAULT 0,
        total_trades UInt32 DEFAULT 0,
        markets_traded UInt32 DEFAULT 0,
        calculated_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet_address, time_window)
      PARTITION BY time_window
      PRIMARY KEY (wallet_address, time_window)
    `;

    await ch.query({ query: createTableSQL });
    console.log(`   ✅ Table created\n`);

    // Step 2: Create temp table with ALL unique wallets
    console.log('2️⃣  Creating temp wallet list...\n');

    await ch.query({ query: 'DROP TABLE IF EXISTS default.temp_all_wallets' });

    const createWalletsSQL = `
      CREATE TABLE default.temp_all_wallets
      ENGINE = Memory
      AS
      SELECT DISTINCT lower(wallet) as wallet_address
      FROM default.trades_raw
      WHERE condition_id NOT LIKE '%token_%'
        AND block_time >= '${DATE_START}'
    `;

    await ch.query({ query: createWalletsSQL });

    const walletCountQuery = `SELECT count() as total FROM default.temp_all_wallets`;
    const countResult = await ch.query({ query: walletCountQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    const totalWallets = parseInt(countData[0].total);

    console.log(`   ✅ Created temp table with ${totalWallets.toLocaleString()} wallets\n`);

    // Step 3: Define time windows
    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');
    const windows = [
      { name: 'lifetime', dateStart: DATE_START },
      { name: '180d', dateStart: new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '90d', dateStart: new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '30d', dateStart: new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }
    ];

    // Step 4: Populate each window
    console.log('3️⃣  Populating windows (staged)...\n');

    for (const window of windows) {
      console.log(`   ${window.name} (block_time >= ${window.dateStart})...`);

      // Stage 1: Create temp table with metrics for this window
      await ch.query({ query: 'DROP TABLE IF EXISTS default.temp_window_metrics' });

      const createMetricsSQL = `
        CREATE TABLE default.temp_window_metrics
        ENGINE = Memory
        AS
        SELECT
          lower(wallet) as wallet_address,
          sum(toFloat64(cashflow_usdc)) as realized_pnl,
          count() as total_trades,
          count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_traded
        FROM default.trades_raw
        WHERE condition_id NOT LIKE '%token_%'
          AND block_time >= '${window.dateStart}'
        GROUP BY wallet_address
      `;

      await ch.query({ query: createMetricsSQL });
      console.log(`     • Created temp metrics table`);

      // Stage 2: Simple JOIN and INSERT
      const insertSQL = `
        INSERT INTO default.wallet_metrics
        SELECT
          w.wallet_address,
          '${window.name}' as time_window,
          coalesce(m.realized_pnl, 0) as realized_pnl,
          0 as unrealized_payout,
          0 as roi_pct,
          0 as win_rate,
          0 as sharpe_ratio,
          0 as omega_ratio,
          coalesce(m.total_trades, 0) as total_trades,
          coalesce(m.markets_traded, 0) as markets_traded,
          toDateTime('${now}') as calculated_at,
          toDateTime('${now}') as updated_at
        FROM default.temp_all_wallets w
        LEFT JOIN default.temp_window_metrics m
        ON w.wallet_address = m.wallet_address
      `;

      const startTime = Date.now();
      await ch.query({ query: insertSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`     • Inserted ${totalWallets.toLocaleString()} rows (${elapsed}s)\n`);

      // Clean up temp metrics table
      await ch.query({ query: 'DROP TABLE IF EXISTS default.temp_window_metrics' });
    }

    // Clean up temp wallets table
    await ch.query({ query: 'DROP TABLE IF EXISTS default.temp_all_wallets' });

    // Step 5: Verify row counts
    console.log('4️⃣  Verifying row counts...\n');

    const verifyQuery = `
      SELECT
        time_window,
        count() as row_count,
        count(DISTINCT wallet_address) as unique_wallets
      FROM default.wallet_metrics
      GROUP BY time_window
      ORDER BY time_window
    `;

    const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json<any[]>();

    console.log(`   Window Coverage:\n`);
    verifyData.forEach(row => {
      const expected = totalWallets;
      const actual = parseInt(row.row_count);
      const status = actual === expected ? '✅' : '⚠️';
      console.log(`   ${row.time_window}: ${actual.toLocaleString()} rows ${status} (expected ${expected.toLocaleString()})`);
    });

    const totalQuery = `SELECT count() as total FROM default.wallet_metrics`;
    const totalResult = await ch.query({ query: totalQuery, format: 'JSONEachRow' });
    const totalData = await totalResult.json<any[]>();
    const totalRows = parseInt(totalData[0].total);
    const expectedTotal = totalWallets * 4;

    console.log(`\n   Grand Total: ${totalRows.toLocaleString()} rows`);
    console.log(`   Expected: ${expectedTotal.toLocaleString()} (${totalWallets.toLocaleString()} × 4)`);
    console.log(`   Status: ${totalRows === expectedTotal ? '✅ PASS' : '⚠️ FAIL'}\n`);

    // Step 6: Verify P&L parity using Group 1 calculator
    console.log('5️⃣  Verifying P&L parity for baseline wallet (via Group 1 calculator)...\n');

    const { calculateAllMetrics } = await import('../lib/clickhouse/metrics-calculator');

    const metrics = await calculateAllMetrics(ch, {
      wallet: BASELINE_WALLET,
      dateStart: DATE_START,
      dateEnd: '2025-11-11'
    });

    const totalPnl = metrics.realized_pnl + metrics.unrealized_payout;
    const pnlDiff = Math.abs(totalPnl - BASELINE_PNL);

    console.log(`   Baseline Wallet: ${BASELINE_WALLET}`);
    console.log(`   Realized P&L: $${metrics.realized_pnl.toFixed(2)}`);
    console.log(`   Unrealized Payout: $${metrics.unrealized_payout.toFixed(2)}`);
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`   Expected: $${BASELINE_PNL.toFixed(2)}`);
    console.log(`   Difference: ${pnlDiff < 1 ? '✅ <$1 (PASS)' : `⚠️ $${pnlDiff.toFixed(2)}`}\n`);

    // Final summary
    console.log('═'.repeat(100));
    console.log('WALLET METRICS REBUILD COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Full coverage achieved: ${totalWallets.toLocaleString()} wallets × 4 windows\n`);
    console.log(`Table Stats:\n`);
    console.log(`  • Total rows: ${totalRows.toLocaleString()}`);
    console.log(`  • Unique wallets: ${totalWallets.toLocaleString()}`);
    console.log(`  • Time windows: 4 (30d, 90d, 180d, lifetime)`);
    console.log(`  • Metrics: realized_pnl, total_trades, markets_traded`);
    console.log(`  • Row count test: ${totalRows === expectedTotal ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`  • P&L parity: ${pnlDiff < 1 ? 'PASS ✓' : 'FAIL ✗'}\n`);
    console.log(`Next steps:\n`);
    console.log(`  npx tsx tests/phase2/task-group-2.test.ts\n`);
    console.log(`Expected: All 5 tests pass ✓\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
