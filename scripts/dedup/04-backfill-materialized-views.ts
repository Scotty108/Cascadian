#!/usr/bin/env tsx
/**
 * Backfill Materialized Views with Historical Data
 *
 * Materialized views only process NEW data after creation.
 * This script backfills existing historical data into the views.
 *
 * Duration: 20-30 minutes total
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function backfillView(
  viewName: string,
  sourceTable: string,
  selectClause: string,
  groupBy: string,
  estimatedRows: number
) {
  console.log(`\n📊 Backfilling ${viewName}...`);
  console.log(`   Target: ~${(estimatedRows / 1000000).toFixed(0)}M rows`);

  const startTime = Date.now();

  try {
    await clickhouse.command({
      query: `
        INSERT INTO ${viewName}
        SELECT ${selectClause}
        FROM ${sourceTable}
        ${groupBy}
      `,
      clickhouse_settings: {
        max_execution_time: 1800, // 30 min
        max_memory_usage: 15000000000, // 15GB
        max_threads: 8,
      },
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✓ ${viewName} backfilled in ${duration} min`);

    // Check final count
    const result = await clickhouse.query({
      query: `SELECT count() as count FROM ${viewName}`,
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    const finalCount = rows[0].count;
    console.log(`   Final count: ${finalCount.toLocaleString()} rows`);

  } catch (error: any) {
    console.error(`❌ Failed to backfill ${viewName}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('🔨 Backfilling Materialized Views with Historical Data\n');
  console.log('This will take 20-30 minutes total...\n');

  const overallStart = Date.now();

  try {
    // 1. Backfill pm_trade_fifo_roi_v3_deduped (fastest - ~5 min)
    await backfillView(
      'pm_trade_fifo_roi_v3_deduped',
      'pm_trade_fifo_roi_v3',
      `wallet, condition_id, outcome_index,
       any(tx_hash) as tx_hash,
       any(entry_time) as entry_time,
       any(resolved_at) as resolved_at,
       any(cost_usd) as cost_usd,
       any(tokens) as tokens,
       any(tokens_sold_early) as tokens_sold_early,
       any(tokens_held) as tokens_held,
       any(exit_value) as exit_value,
       any(pnl_usd) as pnl_usd,
       any(roi) as roi,
       any(pct_sold_early) as pct_sold_early,
       any(is_maker) as is_maker,
       any(is_short) as is_short`,
      'GROUP BY wallet, condition_id, outcome_index',
      78000000
    );

    // 2. Backfill pm_trader_events_v2_deduped (medium - ~8 min)
    await backfillView(
      'pm_trader_events_v2_deduped',
      'pm_trader_events_v2',
      `event_id, trader_wallet, token_id,
       any(side) as side,
       any(usdc_amount) as usdc_amount,
       any(token_amount) as token_amount,
       any(fee_amount) as fee_amount,
       any(trade_time) as trade_time,
       any(transaction_hash) as transaction_hash,
       any(block_number) as block_number,
       any(role) as role`,
      'WHERE is_deleted = 0 GROUP BY event_id, trader_wallet, token_id',
      390000000
    );

    // 3. Backfill pm_canonical_fills_v4_deduped (slowest - ~15 min)
    await backfillView(
      'pm_canonical_fills_v4_deduped',
      'pm_canonical_fills_v4',
      `fill_id, wallet, condition_id, outcome_index,
       any(event_time) as event_time,
       any(block_number) as block_number,
       any(tx_hash) as tx_hash,
       any(tokens_delta) as tokens_delta,
       any(usdc_delta) as usdc_delta,
       any(source) as source,
       any(is_self_fill) as is_self_fill,
       any(is_maker) as is_maker,
       max(_version) as _version`,
      'GROUP BY fill_id, wallet, condition_id, outcome_index',
      940000000
    );

    const totalDuration = ((Date.now() - overallStart) / 1000 / 60).toFixed(1);

    console.log('\n════════════════════════════════════════════════════');
    console.log('✅ All Views Backfilled Successfully!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Total Duration: ${totalDuration} minutes`);
    console.log('\nViews are now fully populated and ready to use!');
    console.log('\nNext step: Run Phase 3 migration');
    console.log('  ./scripts/dedup/03-migrate-queries.sh\n');

  } catch (error: any) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error('\nViews may be partially populated.');
    console.error('You can re-run this script to continue from where it stopped.\n');
    throw error;
  }
}

main().catch(console.error);
