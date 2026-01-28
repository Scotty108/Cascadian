#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Process Month by Month (No Timeout)
 *
 * Instead of finding ALL closed positions at once (times out),
 * process each month separately like V4 does.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const START_MONTH = process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '2024-01';
const END_MONTH = process.argv.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-02';

function generateMonths(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let [year, month] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

async function processMonth(partition: string): Promise<number> {
  console.log(`Processing ${partition}...`);

  // Process this month's closed positions directly
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
          coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) as cumsum_before,
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
          WHERE toYYYYMM(f.event_time) = ${partition}
            AND f.source = 'clob'
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
          WHERE toYYYYMM(event_time) = ${partition}
            AND source = 'clob'
            AND tokens_delta < 0
          GROUP BY wallet, condition_id, outcome_index
        ) sells ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      )
      WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
    `,
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 10000000000,
      max_threads: 8,
      optimize_read_in_window_order: 1,
    },
  });

  // Count what was inserted
  const result = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v3
      WHERE toYYYYMM(resolved_at) = ${partition}
        AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return rows[0]?.cnt || 0;
}

async function main() {
  console.log('🔨 Building FIFO V5 (Monthly Processing)\n');
  console.log(`Range: ${START_MONTH} to ${END_MONTH}\n`);

  const startTime = Date.now();
  const months = generateMonths(START_MONTH, END_MONTH);

  let totalInserted = 0;
  let errors = 0;

  for (let i = 0; i < months.length; i++) {
    const partition = months[i];
    const monthStart = Date.now();

    process.stdout.write(`[${i + 1}/${months.length}] ${partition}... `);

    try {
      const count = await processMonth(partition);
      totalInserted += count;

      const duration = ((Date.now() - monthStart) / 1000).toFixed(1);
      console.log(`✓ ${count} rows (${duration}s)`);
    } catch (error: any) {
      errors++;
      console.log(`✗ ${error.message}`);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Build Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Total rows inserted: ${totalInserted.toLocaleString()}`);
  console.log(`Errors: ${errors}`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log('\nNext: Test with FuelHydrantBoss wallet\n');
}

main().catch(console.error);
