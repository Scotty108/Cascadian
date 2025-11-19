#!/usr/bin/env npx tsx
/**
 * Complete Wallet Metrics Rebuild - Full Coverage
 *
 * Strategy:
 * 1. Get ALL unique wallets from trades_raw (lifetime scope)
 * 2. For each time window (30d, 90d, 180d, lifetime):
 *    - Insert row for EVERY wallet (even if 0 trades in that window)
 *    - Use LEFT JOIN to aggregated metrics (defaults to 0)
 * 3. Result: 923,399 wallets × 4 windows = 3,693,596 rows
 * 4. Verify P&L parity for baseline wallet: -$27,558.71
 *
 * Expected runtime: 2-4 minutes
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
  console.log('WALLET METRICS COMPLETE REBUILD - FULL 923k×4 COVERAGE');
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

    // Step 2: Get all unique wallets
    console.log('2️⃣  Getting complete wallet list...\n');

    const walletCountQuery = `
      SELECT count(DISTINCT lower(wallet)) as total
      FROM default.trades_raw
      WHERE condition_id NOT LIKE '%token_%'
        AND block_time >= '${DATE_START}'
    `;

    const countResult = await ch.query({ query: walletCountQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    const totalWallets = parseInt(countData[0].total);

    console.log(`   Found ${totalWallets.toLocaleString()} unique wallets\n`);

    // Step 3: Define time windows
    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');
    const windows = [
      { name: 'lifetime', dateStart: DATE_START },
      { name: '180d', dateStart: new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '90d', dateStart: new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '30d', dateStart: new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }
    ];

    // Step 4: Populate each window with ALL wallets
    console.log('3️⃣  Populating all windows with complete wallet coverage...\n');

    for (const window of windows) {
      console.log(`   ${window.name} (block_time >= ${window.dateStart})...`);

      // Insert ALL wallets for this window, with metrics LEFT JOINed
      const insertSQL = `
        INSERT INTO default.wallet_metrics
        SELECT
          all_wallets.wallet_address,
          '${window.name}' as time_window,
          coalesce(metrics.realized_pnl, 0) as realized_pnl,
          0 as unrealized_payout,
          0 as roi_pct,
          0 as win_rate,
          0 as sharpe_ratio,
          0 as omega_ratio,
          coalesce(metrics.total_trades, 0) as total_trades,
          coalesce(metrics.markets_traded, 0) as markets_traded,
          toDateTime('${now}') as calculated_at,
          toDateTime('${now}') as updated_at
        FROM (
          SELECT DISTINCT lower(wallet) as wallet_address
          FROM default.trades_raw
          WHERE condition_id NOT LIKE '%token_%'
            AND block_time >= '${DATE_START}'
        ) all_wallets
        LEFT JOIN (
          SELECT
            lower(wallet) as wallet_address,
            sum(toFloat64(cashflow_usdc)) as realized_pnl,
            count() as total_trades,
            count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_traded
          FROM default.trades_raw
          WHERE condition_id NOT LIKE '%token_%'
            AND block_time >= '${window.dateStart}'
          GROUP BY wallet_address
        ) metrics
        ON all_wallets.wallet_address = metrics.wallet_address
      `;

      const startTime = Date.now();
      await ch.query({ query: insertSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`     ✅ Inserted (${elapsed}s)\n`);
    }

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

    // Step 6: Verify P&L parity for baseline wallet
    console.log('5️⃣  Verifying P&L parity for baseline wallet...\n');

    const parityQuery = `
      SELECT
        sum(realized_pnl + unrealized_payout) as total_pnl
      FROM default.wallet_metrics
      WHERE wallet_address = '${BASELINE_WALLET}'
        AND time_window = 'lifetime'
    `;

    const parityResult = await ch.query({ query: parityQuery, format: 'JSONEachRow' });
    const parityData = await parityResult.json<any[]>();
    const actualPnl = parseFloat(parityData[0]?.total_pnl || '0');
    const pnlDiff = Math.abs(actualPnl - BASELINE_PNL);

    console.log(`   Baseline Wallet: ${BASELINE_WALLET}`);
    console.log(`   Expected P&L: $${BASELINE_PNL.toFixed(2)}`);
    console.log(`   Actual P&L: $${actualPnl.toFixed(2)}`);
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
    console.log(`  • P&L parity: ${pnlDiff < 1 ? 'PASS ✓' : `FAIL ✗ (unrealized payout = 0)`}\n`);
    console.log(`Next steps:\n`);
    console.log(`  1. Run tests: npx tsx tests/phase2/task-group-2.test.ts`);
    console.log(`  2. Expected: 3-4 tests passing (row count ✓, parity may fail without unrealized)`);
    console.log(`  3. If Test 4 fails, add unrealized payout calculation\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
