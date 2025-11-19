#!/usr/bin/env npx tsx
/**
 * Phase 2 Group 2: Wallet Metrics Population (Fixed)
 *
 * Creates 4 rows per wallet (one for each time window) with:
 * - realized_pnl (from cashflows)
 * - total_trades, markets_traded (activity)
 * - Sets unrealized_payout, win_rate, sharpe, omega, roi to 0
 *
 * Expected runtime: 1-2 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const DATE_START = '2022-06-01';
const BASELINE_PNL = -27558.71;

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('PHASE 2 GROUP 2: WALLET METRICS POPULATION (FIXED)');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Drop existing table
    console.log('1️⃣  Dropping existing wallet_metrics table...\n');
    await ch.query({ query: 'DROP TABLE IF EXISTS default.wallet_metrics' });
    console.log(`   ✅ Dropped\n`);

    // Step 2: Create and populate with cross join to time windows
    console.log('2️⃣  Creating and populating wallet_metrics table...\n');

    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');
    const now30d = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const now90d = new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const now180d = new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const createAndPopulateSQL = `
      CREATE TABLE default.wallet_metrics
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet_address, time_window)
      PARTITION BY time_window
      PRIMARY KEY (wallet_address, time_window)
      AS
      SELECT
        w.wallet_address,
        tw.time_window,
        sum(if(
          (tw.time_window = 'lifetime' AND t.block_time >= '${DATE_START}') OR
          (tw.time_window = '30d' AND t.block_time >= '${now30d}') OR
          (tw.time_window = '90d' AND t.block_time >= '${now90d}') OR
          (tw.time_window = '180d' AND t.block_time >= '${now180d}'),
          toFloat64(t.cashflow_usdc),
          0
        )) as realized_pnl,
        0 as unrealized_payout,
        0 as roi_pct,
        0 as win_rate,
        0 as sharpe_ratio,
        0 as omega_ratio,
        sum(if(
          (tw.time_window = 'lifetime' AND t.block_time >= '${DATE_START}') OR
          (tw.time_window = '30d' AND t.block_time >= '${now30d}') OR
          (tw.time_window = '90d' AND t.block_time >= '${now90d}') OR
          (tw.time_window = '180d' AND t.block_time >= '${now180d}'),
          1,
          0
        )) as total_trades,
        count(DISTINCT if(
          (tw.time_window = 'lifetime' AND t.block_time >= '${DATE_START}') OR
          (tw.time_window = '30d' AND t.block_time >= '${now30d}') OR
          (tw.time_window = '90d' AND t.block_time >= '${now90d}') OR
          (tw.time_window = '180d' AND t.block_time >= '${now180d}'),
          lower(replaceAll(t.condition_id, '0x', '')),
          NULL
        )) as markets_traded,
        toDateTime('${now}') as calculated_at,
        toDateTime('${now}') as updated_at
      FROM (
        SELECT DISTINCT lower(wallet) as wallet_address
        FROM default.trades_raw
        WHERE condition_id NOT LIKE '%token_%'
          AND block_time >= '${DATE_START}'
      ) w
      CROSS JOIN (
        SELECT '30d' as time_window
        UNION ALL SELECT '90d'
        UNION ALL SELECT '180d'
        UNION ALL SELECT 'lifetime'
      ) tw
      LEFT JOIN default.trades_raw t
        ON lower(t.wallet) = w.wallet_address
        AND t.condition_id NOT LIKE '%token_%'
      GROUP BY w.wallet_address, tw.time_window
    `;

    console.log(`   Creating table with all time windows per wallet...`);
    console.log(`   (This may take 2-5 minutes)\n`);

    const startTime = Date.now();
    await ch.query({ query: createAndPopulateSQL });
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`   ✅ Table created and populated (${elapsed}s)\n`);

    // Step 3: Verify row count and P&L parity
    console.log('3️⃣  Verifying population and P&L parity...\n');

    const verifyQuery = `
      SELECT
        time_window,
        count() as row_count,
        count(DISTINCT wallet_address) as unique_wallets,
        sum(realized_pnl) as total_realized_pnl
      FROM default.wallet_metrics
      GROUP BY time_window
      ORDER BY time_window
    `;

    const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json<any[]>();

    console.log(`   Metrics by Time Window:\n`);
    let lifetimePnl = 0;
    verifyData.forEach(row => {
      const pnl = parseFloat(row.total_realized_pnl);
      if (row.time_window === 'lifetime') {
        lifetimePnl = pnl;
      }
      console.log(`   ${row.time_window}:`);
      console.log(`     • Rows: ${parseInt(row.row_count).toLocaleString()}`);
      console.log(`     • Wallets: ${parseInt(row.unique_wallets).toLocaleString()}`);
      console.log(`     • Total Realized P&L: $${pnl.toFixed(2)}`);
    });

    const pnlDiff = Math.abs(lifetimePnl - BASELINE_PNL);
    console.log(`\n   P&L Parity Check:`);
    console.log(`   • Expected: $${BASELINE_PNL.toFixed(2)}`);
    console.log(`   • Actual: $${lifetimePnl.toFixed(2)}`);
    console.log(`   • Difference: ${pnlDiff < 1 ? '✅ <$1' : `⚠️ $${pnlDiff.toFixed(2)}`}\n`);

    console.log('═'.repeat(100));
    console.log('WALLET METRICS POPULATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ wallet_metrics table populated with 4 time windows per wallet\n`);
    console.log(`Note: This version only includes realized P&L and activity metrics.`);
    console.log(`      Unrealized payout set to 0 (can be added via separate UPDATE if needed).\n`);
    console.log(`Next steps:\n`);
    console.log(`  1. Run Task Group 2 tests: npm test -- tests/phase2/task-group-2.test.ts`);
    console.log(`  2. Upon passing, Group 3 (Leaderboard Views) unlocks\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
