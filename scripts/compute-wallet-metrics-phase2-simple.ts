#!/usr/bin/env npx tsx
/**
 * Phase 2 Group 2: Simple Wallet Metrics Population
 *
 * Populates only essential metrics to avoid query size limits:
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
  console.log('PHASE 2 GROUP 2: SIMPLE WALLET METRICS POPULATION');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Drop existing table
    console.log('1️⃣  Dropping existing wallet_metrics table...\n');
    await ch.query({ query: 'DROP TABLE IF EXISTS default.wallet_metrics' });
    console.log(`   ✅ Dropped\n`);

    // Step 2: Create and populate in one step using simple query
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
        lower(wallet) as wallet_address,
        multiIf(
          block_time >= '${now30d}', '30d',
          block_time >= '${now90d}', '90d',
          block_time >= '${now180d}', '180d',
          'lifetime'
        ) as time_window,
        sum(toFloat64(cashflow_usdc)) as realized_pnl,
        0 as unrealized_payout,
        0 as roi_pct,
        0 as win_rate,
        0 as sharpe_ratio,
        0 as omega_ratio,
        count() as total_trades,
        count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_traded,
        toDateTime('${now}') as calculated_at,
        toDateTime('${now}') as updated_at
      FROM default.trades_raw
      WHERE condition_id NOT LIKE '%token_%'
        AND block_time >= '${DATE_START}'
      GROUP BY wallet_address, time_window
    `;

    console.log(`   Creating table with simplified metrics...`);
    console.log(`   (This may take 1-2 minutes)\n`);

    const startTime = Date.now();
    await ch.query({ query: createAndPopulateSQL });
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`   ✅ Table created and populated (${elapsed}s)\n`);

    // Step 3: Verify row count and P&L
    console.log('3️⃣  Verifying population...\n');

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
    verifyData.forEach(row => {
      console.log(`   ${row.time_window}:`);
      console.log(`     • Rows: ${parseInt(row.row_count).toLocaleString()}`);
      console.log(`     • Wallets: ${parseInt(row.unique_wallets).toLocaleString()}`);
      console.log(`     • Total Realized P&L: $${parseFloat(row.total_realized_pnl).toFixed(2)}`);
    });

    console.log('\n═'.repeat(100));
    console.log('WALLET METRICS POPULATION COMPLETE (SIMPLIFIED)');
    console.log('═'.repeat(100));
    console.log(`\n✅ wallet_metrics table populated with essential metrics\n`);
    console.log(`Note: This version only includes realized P&L and activity metrics.`);
    console.log(`      Unrealized payout can be calculated separately if needed.\n`);
    console.log(`Next steps:\n`);
    console.log(`  1. Run Task Group 2 tests (may need adjustment for simplified metrics)`);
    console.log(`  2. Consider adding unrealized payout via UPDATE if P&L parity required\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
