/**
 * Rebuild pm_copy_backtest_v1 - Copy Trading Backtesting Stats
 *
 * Computes equal-weight copy trading ROI for all wallets across multiple windows:
 * - Trade-count: Last 10, 25, 50, 200 trades
 * - Time-based: Last 3, 7, 14, 30 days
 *
 * Uses server-side INSERT INTO SELECT for efficiency.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TRADE_WINDOWS = [10, 25, 50, 200];
const DAY_WINDOWS = [3, 7, 14, 30];

async function processTradeWindow(windowSize: number): Promise<number> {
  const windowType = `trade_${windowSize}`;
  console.log(`  Processing ${windowType}...`);

  const query = `
    INSERT INTO pm_copy_backtest_v1
    SELECT
      pos.wallet,
      pos.category,
      '${windowType}' as window_type,
      toUInt32(count()) as total_trades,
      toUInt32(countIf(pos.roi_pct > 0)) as wins,
      toUInt32(countIf(pos.roi_pct <= 0)) as losses,
      round(countIf(pos.roi_pct > 0) / count(), 4) as win_rate,
      round(sum(pos.roi_pct), 2) as total_roi_pct,
      round(sum(pos.roi_pct_slip), 2) as total_roi_with_slippage,
      round(avg(pos.roi_pct), 2) as avg_roi_per_trade,
      round(avg(pos.hours_to_exit), 2) as avg_hours_to_exit,
      round(median(pos.hours_to_exit), 2) as median_hours_to_exit,
      toUInt32(0) as early_exits,
      toUInt32(count()) as held_to_resolution,
      round(sum(pos.roi_pct) * (1 + log10(1 + 720 / greatest(avg(pos.hours_to_exit), 1))), 2) as composite_score,
      max(pos.entry_time) as last_trade,
      now() as computed_at
    FROM (
      SELECT
        lower(t.trader_wallet) as wallet,
        coalesce(m.category, 'Other') as category,
        t.trade_time as entry_time,
        (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
        ((toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1)) - (t.usdc_amount / nullIf(t.token_amount, 0))) / (t.usdc_amount / nullIf(t.token_amount, 0)) * 100 as roi_pct,
        ((toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1)) - (t.usdc_amount / nullIf(t.token_amount, 0)) * 1.02) / ((t.usdc_amount / nullIf(t.token_amount, 0)) * 1.02) * 100 as roi_pct_slip,
        dateDiff('hour', t.trade_time, r.resolved_at) as hours_to_exit,
        row_number() OVER (PARTITION BY lower(t.trader_wallet), coalesce(m.category, 'Other') ORDER BY t.trade_time DESC) as rn
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      LEFT JOIN pm_market_metadata m ON map.condition_id = m.condition_id
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy'
        AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
    ) pos
    WHERE pos.rn <= ${windowSize}
    GROUP BY pos.wallet, pos.category
    HAVING count() >= 5
    SETTINGS max_execution_time = 600, max_memory_usage = 8000000000
  `;

  await clickhouse.command({ query });

  // Get count of inserted rows
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_copy_backtest_v1 WHERE window_type = '${windowType}'`,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: number }[];
  const inserted = countRows[0]?.cnt || 0;
  console.log(`    ✓ ${windowType}: ${inserted.toLocaleString()} rows`);
  return inserted;
}

async function processDayWindow(windowDays: number): Promise<number> {
  const windowType = `day_${windowDays}`;
  console.log(`  Processing ${windowType}...`);

  const query = `
    INSERT INTO pm_copy_backtest_v1
    SELECT
      pos.wallet,
      pos.category,
      '${windowType}' as window_type,
      toUInt32(count()) as total_trades,
      toUInt32(countIf(pos.roi_pct > 0)) as wins,
      toUInt32(countIf(pos.roi_pct <= 0)) as losses,
      round(countIf(pos.roi_pct > 0) / count(), 4) as win_rate,
      round(sum(pos.roi_pct), 2) as total_roi_pct,
      round(sum(pos.roi_pct_slip), 2) as total_roi_with_slippage,
      round(avg(pos.roi_pct), 2) as avg_roi_per_trade,
      round(avg(pos.hours_to_exit), 2) as avg_hours_to_exit,
      round(median(pos.hours_to_exit), 2) as median_hours_to_exit,
      toUInt32(0) as early_exits,
      toUInt32(count()) as held_to_resolution,
      round(sum(pos.roi_pct) * (1 + log10(1 + 720 / greatest(avg(pos.hours_to_exit), 1))), 2) as composite_score,
      max(pos.entry_time) as last_trade,
      now() as computed_at
    FROM (
      SELECT
        lower(t.trader_wallet) as wallet,
        coalesce(m.category, 'Other') as category,
        t.trade_time as entry_time,
        (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
        ((toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1)) - (t.usdc_amount / nullIf(t.token_amount, 0))) / (t.usdc_amount / nullIf(t.token_amount, 0)) * 100 as roi_pct,
        ((toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1)) - (t.usdc_amount / nullIf(t.token_amount, 0)) * 1.02) / ((t.usdc_amount / nullIf(t.token_amount, 0)) * 1.02) * 100 as roi_pct_slip,
        dateDiff('hour', t.trade_time, r.resolved_at) as hours_to_exit
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      LEFT JOIN pm_market_metadata m ON map.condition_id = m.condition_id
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy'
        AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL ${windowDays} DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
    ) pos
    GROUP BY pos.wallet, pos.category
    HAVING count() >= 5
    SETTINGS max_execution_time = 600, max_memory_usage = 8000000000
  `;

  await clickhouse.command({ query });

  // Get count of inserted rows
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_copy_backtest_v1 WHERE window_type = '${windowType}'`,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: number }[];
  const inserted = countRows[0]?.cnt || 0;
  console.log(`    ✓ ${windowType}: ${inserted.toLocaleString()} rows`);
  return inserted;
}

async function main() {
  console.log('=== Rebuilding pm_copy_backtest_v1 ===\n');
  const startTime = Date.now();

  // Truncate existing data
  console.log('Truncating existing data...');
  await clickhouse.command({ query: 'TRUNCATE TABLE pm_copy_backtest_v1' });

  let totalRows = 0;

  // Process trade-count windows
  console.log('\nTrade-count windows:');
  for (const windowSize of TRADE_WINDOWS) {
    totalRows += await processTradeWindow(windowSize);
  }

  // Process day windows
  console.log('\nTime-based windows:');
  for (const windowDays of DAY_WINDOWS) {
    totalRows += await processDayWindow(windowDays);
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const check = await clickhouse.query({
    query: `
      SELECT
        window_type,
        count() as rows,
        countDistinct(wallet) as wallets,
        round(avg(composite_score), 2) as avg_composite,
        round(max(composite_score), 2) as max_composite
      FROM pm_copy_backtest_v1
      GROUP BY window_type
      ORDER BY window_type
    `,
    format: 'JSONEachRow'
  });

  console.log('\n=== Summary ===');
  const summary = await check.json() as any[];
  console.table(summary);
  console.log(`\n✅ Total rows: ${totalRows.toLocaleString()} in ${elapsed}s`);
}

main().catch(console.error);
