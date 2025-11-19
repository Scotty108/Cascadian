#!/usr/bin/env npx tsx
/**
 * Add Unrealized Payout to Wallet Metrics
 *
 * Updates wallet_metrics with unrealized_payout calculated from:
 * - Net shares (BUY adds, SELL subtracts)
 * - Payout vectors from market_resolutions_final
 * - Formula: shares × payout_numerators[winning_index + 1] / payout_denominator
 *
 * Expected runtime: 3-5 minutes (processes all windows)
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
  console.log('ADDING UNREALIZED PAYOUT TO WALLET METRICS');
  console.log('═'.repeat(100) + '\n');

  try {
    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');

    const windows = [
      { name: 'lifetime', dateStart: DATE_START },
      { name: '180d', dateStart: new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '90d', dateStart: new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      { name: '30d', dateStart: new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }
    ];

    console.log('Calculating unrealized payout for each window...\n');

    for (const window of windows) {
      console.log(`   ${window.name} (block_time >= ${window.dateStart})...`);

      // Use ALTER TABLE UPDATE to set unrealized_payout
      // ReplacingMergeTree requires this pattern for updates
      const updateSQL = `
        ALTER TABLE default.wallet_metrics
        UPDATE unrealized_payout = (
          SELECT coalesce(sum(
            toFloat64(net_shares) *
            arrayElement(mr.payout_numerators, mr.winning_index + 1) /
            toFloat64(mr.payout_denominator)
          ), 0)
          FROM (
            SELECT
              lower(wallet) as wallet,
              lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
              SUM(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) as net_shares
            FROM default.trades_raw
            WHERE condition_id NOT LIKE '%token_%'
              AND block_time >= '${window.dateStart}'
              AND lower(wallet) = wallet_metrics.wallet_address
            GROUP BY wallet, condition_id_norm
            HAVING net_shares != 0
          ) pos
          INNER JOIN default.market_resolutions_final mr
            ON pos.condition_id_norm = mr.condition_id_norm
          WHERE mr.payout_denominator != 0
        ),
        updated_at = toDateTime('${now}')
        WHERE time_window = '${window.name}'
      `;

      const startTime = Date.now();
      await ch.query({ query: updateSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`     ✅ Updated (${elapsed}s)\n`);
    }

    // Verify P&L parity for baseline wallet
    console.log('Verifying P&L parity for baseline wallet...\n');

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

    console.log(`   Baseline Wallet: ${BASELINE_WALLET}`);
    console.log(`   Realized P&L: $${realizedPnl.toFixed(2)}`);
    console.log(`   Unrealized Payout: $${unrealizedPayout.toFixed(2)}`);
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`   Expected: $${BASELINE_PNL.toFixed(2)}`);
    console.log(`   Difference: ${pnlDiff < 1 ? '✅ <$1 (PASS)' : `⚠️ $${pnlDiff.toFixed(2)}`}\n`);

    console.log('═'.repeat(100));
    console.log('UNREALIZED PAYOUT CALCULATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Unrealized payout added to all windows\n`);
    console.log(`Next step: Run tests to verify all 5 tests pass\n`);
    console.log(`  npx tsx tests/phase2/task-group-2.test.ts\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
