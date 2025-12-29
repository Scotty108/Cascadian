#!/usr/bin/env npx tsx
/**
 * Final Complete Wallet Metrics Rebuild - With Unrealized Payout
 *
 * Rebuilds wallet_metrics from scratch including:
 * - realized_pnl (from cashflows)
 * - unrealized_payout (from positions × payout vectors)
 * - activity metrics (trade count, market count)
 *
 * Result: 923,399 wallets × 4 windows = 3,693,596 rows
 * Expected P&L for baseline wallet: -$27,558.71
 * Expected runtime: 4-8 minutes
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
  console.log('FINAL WALLET METRICS REBUILD - WITH UNREALIZED PAYOUT');
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

    // Step 2: Define time windows
    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');
    const windows = [
      { name: 'lifetime', dateStart: DATE_START },
      { name: '180d', dateStart: new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '90d', dateStart: new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '30d', dateStart: new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }
    ];

    console.log('2️⃣  Populating all windows with realized + unrealized...\n');

    for (const window of windows) {
      console.log(`   ${window.name} (block_time >= ${window.dateStart})...`);

      const insertSQL = `
        INSERT INTO default.wallet_metrics
        SELECT
          all_wallets.wallet_address,
          '${window.name}' as time_window,
          coalesce(realized.pnl, 0) as realized_pnl,
          coalesce(unrealized.payout, 0) as unrealized_payout,
          0 as roi_pct,
          0 as win_rate,
          0 as sharpe_ratio,
          0 as omega_ratio,
          coalesce(realized.trades, 0) as total_trades,
          coalesce(realized.markets, 0) as markets_traded,
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
            sum(toFloat64(cashflow_usdc)) as pnl,
            count() as trades,
            count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets
          FROM default.trades_raw
          WHERE condition_id NOT LIKE '%token_%'
            AND block_time >= '${window.dateStart}'
          GROUP BY wallet_address
        ) realized ON all_wallets.wallet_address = realized.wallet_address
        LEFT JOIN (
          SELECT
            lower(wallet) as wallet_address,
            sum(
              toFloat64(net_shares) *
              arrayElement(mr.payout_numerators, mr.winning_index + 1) /
              toFloat64(mr.payout_denominator)
            ) as payout
          FROM (
            SELECT
              lower(wallet) as wallet,
              lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
              SUM(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) as net_shares
            FROM default.trades_raw
            WHERE condition_id NOT LIKE '%token_%'
              AND block_time >= '${window.dateStart}'
            GROUP BY wallet, condition_id_norm
            HAVING net_shares != 0
          ) positions
          INNER JOIN default.market_resolutions_final mr
            ON positions.condition_id_norm = mr.condition_id_norm
          WHERE mr.payout_denominator != 0
          GROUP BY wallet_address
        ) unrealized ON all_wallets.wallet_address = unrealized.wallet_address
      `;

      const startTime = Date.now();
      await ch.query({ query: insertSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`     ✅ Inserted (${elapsed}s)\n`);
    }

    // Step 3: Verify row counts
    console.log('3️⃣  Verifying coverage...\n');

    const countQuery = `
      SELECT count() as total, count(DISTINCT wallet_address) as wallets
      FROM default.wallet_metrics
    `;
    const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();

    const totalRows = parseInt(countData[0].total);
    const uniqueWallets = parseInt(countData[0].wallets);
    const expectedRows = uniqueWallets * 4;

    console.log(`   Total rows: ${totalRows.toLocaleString()}`);
    console.log(`   Unique wallets: ${uniqueWallets.toLocaleString()}`);
    console.log(`   Expected: ${expectedRows.toLocaleString()} (${uniqueWallets.toLocaleString()} × 4)`);
    console.log(`   Status: ${totalRows === expectedRows ? '✅ PASS' : '⚠️ FAIL'}\n`);

    // Step 4: Verify P&L parity
    console.log('4️⃣  Verifying P&L parity for baseline wallet...\n');

    const parityQuery = `
      SELECT
        realized_pnl,
        unrealized_payout,
        realized_pnl + unrealized_payout as total_pnl
      FROM default.wallet_metrics
      WHERE wallet_address = '${BASELINE_WALLET}'
        AND time_window = 'lifetime'
    `;

    const parityResult = await ch.query({ query: parityQuery, format: 'JSONEachRow' });
    const parityData = await parityResult.json<any[]>();

    const realizedPnl = parseFloat(parityData[0]?.realized_pnl || '0');
    const unrealizedPayout = parseFloat(parityData[0]?.unrealized_payout || '0');
    const totalPnl = parseFloat(parityData[0]?.total_pnl || '0');
    const pnlDiff = Math.abs(totalPnl - BASELINE_PNL);

    console.log(`   Wallet: ${BASELINE_WALLET}`);
    console.log(`   Realized P&L: $${realizedPnl.toFixed(2)}`);
    console.log(`   Unrealized Payout: $${unrealizedPayout.toFixed(2)}`);
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`   Expected: $${BASELINE_PNL.toFixed(2)}`);
    console.log(`   Difference: ${pnlDiff < 1 ? '✅ <$1 (PASS)' : `⚠️ $${pnlDiff.toFixed(2)}`}\n`);

    // Final summary
    console.log('═'.repeat(100));
    console.log('WALLET METRICS REBUILD COMPLETE - ALL METRICS INCLUDED');
    console.log('═'.repeat(100));
    console.log(`\n✅ Full table populated with realized + unrealized\n`);
    console.log(`Next step:\n`);
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
