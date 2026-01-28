#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Process ALL unresolved markets at once
 *
 * No wallet filtering. No activity filtering. Just pure FIFO for all closed positions.
 * Window functions partition by wallet, so this works fine.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🔨 Building FIFO V5 (ALL UNRESOLVED MARKETS)\n');
  console.log('Strategy: Process FIFO for ALL closed positions in unresolved markets');
  console.log('No wallet filtering. Pure SQL.\n');

  const startTime = Date.now();

  console.log('Running FIFO calculation...\n');

  // Process ALL unresolved markets in one query
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        tokens,
        cost_usd,
        tokens_sold_early,
        tokens_held,
        exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE
          WHEN (total_tokens_sold + tokens_held) > 0 THEN
            tokens_sold_early / (total_tokens_sold + tokens_held) * 100
          ELSE 0
        END as pct_sold_early,
        is_maker_flag as is_maker,
        resolved_at,
        0 as is_short,
        1 as is_closed
      FROM (
        SELECT
          buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_sold_early,
          buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_held,
          CASE
            WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
              least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) * (coalesce(sells.total_sell_proceeds, 0) / coalesce(sells.total_tokens_sold, 1))
            ELSE 0
          END as exit_value
        FROM (
          SELECT
            f.fill_id as tx_hash,
            f.wallet,
            f.condition_id,
            f.outcome_index,
            f.event_time as entry_time,
            f.tokens_delta as tokens,
            abs(f.usdc_delta) as cost_usd,
            f.is_maker as is_maker_flag,
            max(f.event_time) OVER (PARTITION BY f.wallet, f.condition_id, f.outcome_index) as resolved_at
          FROM pm_canonical_fills_v4_deduped f
          LEFT JOIN pm_condition_resolutions r
            ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.source = 'clob'
            AND f.tokens_delta > 0
            AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
          ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
        ) buy
        LEFT JOIN (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            abs(sum(tokens_delta)) as total_tokens_sold,
            sum(usdc_delta) as total_sell_proceeds
          FROM pm_canonical_fills_v4_deduped
          WHERE source = 'clob'
            AND tokens_delta < 0
          GROUP BY wallet, condition_id, outcome_index
        ) sells ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      )
      WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour
      max_memory_usage: 20000000000, // 20GB
      max_threads: 8,
      optimize_read_in_window_order: 1,
      query_plan_enable_optimizations: 1,
      max_insert_threads: 4,
    },
  });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Count inserted rows
  const result = await clickhouse.query({
    query: `SELECT count() as cnt, round(sum(pnl_usd), 0) as total_pnl FROM pm_trade_fifo_roi_v3 WHERE is_closed = 1`,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Total FIFO rows (closed positions): ${stats.cnt.toLocaleString()}`);
  console.log(`Total closed PnL: $${stats.total_pnl.toLocaleString()}`);
  console.log(`Duration: ${duration} minutes`);
  console.log('\n🎯 Your leaderboards are now ready!');
  console.log('   Query: SELECT wallet, sum(pnl_usd) FROM pm_trade_fifo_roi_v3_deduped GROUP BY wallet\n');
}

main().catch(console.error);
