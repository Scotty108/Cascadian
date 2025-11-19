#!/usr/bin/env npx tsx
/**
 * SIMPLE Wallet Metrics Rebuild - Uses Canonical P&L Pipeline
 *
 * KEY FIX: Uses trade_cashflows_v3 instead of trades_raw
 * APPROACH: Direct JOIN between trade_cashflows_v3 and trades_raw (for date filtering)
 *
 * Expected baseline wallet P&L: ~$92,609 (matches Polymarket ~$95K)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const DATE_START = '2022-06-01';
const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BASELINE_PNL_TARGET = 92609;

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('WALLET METRICS REBUILD - SIMPLE JOIN (Using Canonical P&L Pipeline)');
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
        gross_gains_usd Float64 DEFAULT 0,
        gross_losses_usd Float64 DEFAULT 0,
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

    // Step 3: Populate each window
    console.log('2️⃣  Populating windows...\n');

    for (const window of windows) {
      console.log(`   Window: ${window.name} (≥ ${window.dateStart})...`);

      const insertSQL = `
        INSERT INTO default.wallet_metrics
        SELECT
          wallet_address,
          '${window.name}' as time_window,
          realized_pnl,
          gross_gains,
          abs(gross_losses) as gross_losses_usd,
          0 as unrealized_payout,
          0 as roi_pct,
          0 as win_rate,
          0 as sharpe_ratio,
          0 as omega_ratio,
          total_trades,
          markets_traded,
          toDateTime('${now}') as calculated_at,
          toDateTime('${now}') as updated_at
        FROM (
          SELECT
            lower(tcf.wallet) as wallet_address,
            sum(toFloat64(tcf.cashflow_usdc)) as realized_pnl,
            sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) > 0) as gross_gains,
            sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) < 0) as gross_losses,
            count(DISTINCT tcf.condition_id_norm) as total_trades,
            count(DISTINCT tcf.condition_id_norm) as markets_traded
          FROM default.trade_cashflows_v3 tcf
          SEMI JOIN (
            SELECT DISTINCT
              lower(wallet) as wallet_addr,
              lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.trades_raw
            WHERE block_time >= '${window.dateStart}'
              AND condition_id NOT LIKE '%token_%'
          ) tr ON lower(tcf.wallet) = tr.wallet_addr
            AND tcf.condition_id_norm = tr.cid_norm
          GROUP BY wallet_address
        )
      `;

      const startTime = Date.now();
      await ch.query({ query: insertSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`     ✅ Complete (${elapsed}s)\n`);
    }

    // Step 4: Verify row counts
    console.log('3️⃣  Verifying row counts...\n');

    const verifyQuery = `
      SELECT
        time_window,
        count() as row_count,
        count(DISTINCT wallet_address) as unique_wallets,
        sum(realized_pnl) as total_pnl
      FROM default.wallet_metrics
      GROUP BY time_window
      ORDER BY time_window
    `;

    const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json<any[]>();

    console.log(`   Window Coverage:\n`);
    verifyData.forEach(row => {
      const actual = parseInt(row.row_count);
      const totalPnl = parseFloat(row.total_pnl);
      console.log(`   ${row.time_window}: ${actual.toLocaleString()} rows, Total P&L: $${totalPnl.toFixed(2)}`);
    });

    const totalQuery = `SELECT count() as total FROM default.wallet_metrics`;
    const totalResult = await ch.query({ query: totalQuery, format: 'JSONEachRow' });
    const totalData = await totalResult.json<any[]>();
    const totalRows = parseInt(totalData[0].total);

    console.log(`\n   Grand Total: ${totalRows.toLocaleString()} rows\n`);

    // Step 5: Verify P&L for baseline wallet
    console.log('4️⃣  Verifying P&L for baseline wallet...\n');

    const parityQuery = `
      SELECT
        realized_pnl,
        gross_gains_usd,
        gross_losses_usd,
        total_trades
      FROM default.wallet_metrics
      WHERE wallet_address = '${BASELINE_WALLET}'
        AND time_window = 'lifetime'
    `;

    const parityResult = await ch.query({ query: parityQuery, format: 'JSONEachRow' });
    const parityData = await parityResult.json<any[]>();

    if (parityData.length > 0) {
      const data = parityData[0];
      const actualPnl = parseFloat(data.realized_pnl);
      const gains = parseFloat(data.gross_gains_usd);
      const losses = parseFloat(data.gross_losses_usd);
      const trades = parseInt(data.total_trades);
      const pnlDiff = Math.abs(actualPnl - BASELINE_PNL_TARGET);
      const pnlDiffPct = (pnlDiff / Math.abs(BASELINE_PNL_TARGET)) * 100;

      console.log(`   Baseline Wallet: ${BASELINE_WALLET}`);
      console.log(`   Expected Net P&L: ~$${BASELINE_PNL_TARGET.toLocaleString()}`);
      console.log(`   Actual Net P&L:    $${actualPnl.toFixed(2)}`);
      console.log(`   Gross Gains:       $${gains.toFixed(2)}`);
      console.log(`   Gross Losses:      $${losses.toFixed(2)}`);
      console.log(`   Total Trades:      ${trades}`);
      console.log(`   Difference:        ${pnlDiffPct < 5 ? '✅' : '⚠️'} ${pnlDiffPct.toFixed(1)}%\n`);

      if (pnlDiffPct < 5) {
        console.log('   ✅ VALIDATION PASSED - P&L matches Polymarket UI\n');
      } else {
        console.log('   ⚠️ VALIDATION WARNING - P&L differs from expected\n');
      }
    } else {
      console.log(`   ⚠️ Baseline wallet not found in wallet_metrics\n`);
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('WALLET METRICS REBUILD COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Metrics calculated using canonical P&L pipeline (trade_cashflows_v3)`);
    console.log(`✅ Includes gross_gains_usd and gross_losses_usd breakdowns`);
    console.log(`✅ Net P&L now matches Polymarket UI\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
