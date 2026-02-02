#!/usr/bin/env npx tsx
/**
 * Custom Leaderboard Export
 *
 * Filters:
 * 1. Trading days > 5
 * 2. Markets > 8
 * 3. Trades > 30
 * 4. Buy trade in last 5 days
 * 5. Median bet > $10
 * 6. Quality Score (all time) > 0
 * 7. Quality Score 14d > 0
 * 8. Quality Score 7d > 0
 * 9. Rank by quality_score_14d
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.query({ query: sql });
}

async function main() {
  console.log('=== Custom Leaderboard Export ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Step 1: Wallets with > 5 trading days
  console.log('Step 1: Finding wallets with > 5 trading days...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step1`);
  await execute(`
    CREATE TABLE tmp_custom_step1 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, uniqExact(toDate(entry_time)) as trading_days
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet
    HAVING trading_days > 5
  `);
  const step1 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step1`);
  console.log(`  → ${step1[0].c.toLocaleString()} wallets with > 5 trading days\n`);

  // Step 2: Wallets with > 8 markets
  console.log('Step 2: Filtering to wallets with > 8 markets...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step2`);
  await execute(`
    CREATE TABLE tmp_custom_step2 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, countDistinct(t.condition_id) as markets_traded
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step1 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING markets_traded > 8
  `);
  const step2 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step2`);
  console.log(`  → ${step2[0].c.toLocaleString()} wallets with > 8 markets\n`);

  // Step 3: Wallets with > 30 trades
  console.log('Step 3: Filtering to wallets with > 30 trades...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step3`);
  await execute(`
    CREATE TABLE tmp_custom_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, count() as total_trades
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step2 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING total_trades > 30
  `);
  const step3 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step3`);
  console.log(`  → ${step3[0].c.toLocaleString()} wallets with > 30 trades\n`);

  // Step 4: Wallets with at least 1 buy trade in last 5 days
  console.log('Step 4: Filtering to wallets with buy trade in last 5 days...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step4`);
  await execute(`
    CREATE TABLE tmp_custom_step4 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT DISTINCT t.wallet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step3 s ON t.wallet = s.wallet
    WHERE t.entry_time >= now() - INTERVAL 5 DAY
  `);
  const step4 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step4`);
  console.log(`  → ${step4[0].c.toLocaleString()} wallets with buy trade in last 5 days\n`);

  // Step 5: Wallets with median bet > $10
  console.log('Step 5: Filtering to wallets with median bet > $10...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step5`);
  await execute(`
    CREATE TABLE tmp_custom_step5 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.5)(t.cost_usd) as median_bet
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step4 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING median_bet > 10
  `);
  const step5_median = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step5`);
  console.log(`  → ${step5_median[0].c.toLocaleString()} wallets with median bet > $10\n`);

  // Step 6: Wallets with Quality Score (all time) > 0
  // Quality Score = sqrt(ev_per_active_day * log_return_per_active_day)
  // This requires both EV > 0 and Log Growth > 0
  console.log('Step 6: Filtering to wallets with Quality Score (all time) > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step6`);
  await execute(`
    CREATE TABLE tmp_custom_step6 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      -- EV calculation
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
      -- Log growth
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth,
      -- Trades per active day
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
      -- Quality score components
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / uniqExact(toDate(t.entry_time))) * 100 as ev_per_active_day,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / uniqExact(toDate(t.entry_time))) * 100 as log_return_per_active_day
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step5 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING ev > 0 AND log_growth > 0
  `);
  const step6 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step6`);
  console.log(`  → ${step6[0].c.toLocaleString()} wallets with Quality Score (all time) > 0\n`);

  // Step 7: Wallets with Quality Score 14d > 0
  console.log('Step 7: Filtering to wallets with Quality Score 14d > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step7`);
  await execute(`
    CREATE TABLE tmp_custom_step7 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step6 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
      AND t.entry_time >= now() - INTERVAL 14 DAY
    GROUP BY t.wallet
    HAVING ev_14d > 0 AND log_growth_14d > 0
  `);
  const step7 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step7`);
  console.log(`  → ${step7[0].c.toLocaleString()} wallets with Quality Score 14d > 0\n`);

  // Step 8: Wallets with Quality Score 7d > 0
  console.log('Step 8: Filtering to wallets with Quality Score 7d > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step8`);
  await execute(`
    CREATE TABLE tmp_custom_step8 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_7d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step7 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
      AND t.entry_time >= now() - INTERVAL 7 DAY
    GROUP BY t.wallet
    HAVING ev_7d > 0 AND log_growth_7d > 0
  `);
  const step8 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step8`);
  console.log(`  → ${step8[0].c.toLocaleString()} wallets with Quality Score 7d > 0\n`);

  // Step 9: Calculate all metrics for final wallets
  console.log('Step 9: Calculating all metrics...');

  // Lifetime metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_lifetime`);
  await execute(`
    CREATE TABLE tmp_custom_lifetime ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      countIf(t.pnl_usd > 0) / count() as win_rate,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
      uniqExact(toDate(t.entry_time)) as trading_days,
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as log_return_pct_per_day,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as log_return_pct_per_active_day,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as ev_per_day,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as ev_per_active_day,
      avg(t.pnl_usd / t.cost_usd) as mean_roi,
      stddevPop(t.pnl_usd / t.cost_usd) as volatility,
      sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))) as downside_deviation,
      avg(t.pnl_usd / t.cost_usd) / nullIf(sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))), 0) as sortino_ratio,
      sqrt(
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
        *
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
      ) as quality_score,
      sum(t.pnl_usd) as total_pnl,
      sum(t.cost_usd) as total_volume,
      countDistinct(t.condition_id) as markets_traded,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade,
      avg(dateDiff('minute', t.entry_time, t.resolved_at)) as avg_hold_time_minutes
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step8 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);

  // 14-day metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_14d`);
  await execute(`
    CREATE TABLE tmp_custom_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      countIf(t.pnl_usd > 0) / count() as win_rate_14d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days_14d,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day_14d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as log_return_pct_per_day_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as log_return_pct_per_active_day_14d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as ev_per_day_14d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as ev_per_active_day_14d,
      avg(t.pnl_usd / t.cost_usd) as mean_roi_14d,
      stddevPop(t.pnl_usd / t.cost_usd) as volatility_14d,
      sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))) as downside_deviation_14d,
      avg(t.pnl_usd / t.cost_usd) / nullIf(sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))), 0) as sortino_ratio_14d,
      sqrt(
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
        *
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
      ) as quality_score_14d,
      sum(t.pnl_usd) as total_pnl_14d,
      sum(t.cost_usd) as total_volume_14d,
      countDistinct(t.condition_id) as markets_traded_14d,
      avg(dateDiff('minute', t.entry_time, t.resolved_at)) as avg_hold_time_minutes_14d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step8 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
      AND t.entry_time >= now() - INTERVAL 14 DAY
    GROUP BY t.wallet
  `);

  // 7-day metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_7d`);
  await execute(`
    CREATE TABLE tmp_custom_7d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      countIf(t.pnl_usd > 0) / count() as win_rate_7d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days_7d,
      uniqExact(toDate(t.entry_time)) as trading_days_7d,
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day_7d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as log_return_pct_per_day_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as log_return_pct_per_active_day_7d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as ev_per_day_7d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as ev_per_active_day_7d,
      avg(t.pnl_usd / t.cost_usd) as mean_roi_7d,
      stddevPop(t.pnl_usd / t.cost_usd) as volatility_7d,
      sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))) as downside_deviation_7d,
      avg(t.pnl_usd / t.cost_usd) / nullIf(sqrt(avg(pow(least(t.pnl_usd / t.cost_usd, 0), 2))), 0) as sortino_ratio_7d,
      sqrt(
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
        *
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / uniqExact(toDate(t.entry_time))) * 100
      ) as quality_score_7d,
      sum(t.pnl_usd) as total_pnl_7d,
      sum(t.cost_usd) as total_volume_7d,
      countDistinct(t.condition_id) as markets_traded_7d,
      avg(dateDiff('minute', t.entry_time, t.resolved_at)) as avg_hold_time_minutes_7d
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_custom_step8 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
      AND t.entry_time >= now() - INTERVAL 7 DAY
    GROUP BY t.wallet
  `);

  // Join all metrics
  console.log('Step 9: Joining all metrics and exporting...');
  const finalData = await query<Record<string, any>>(`
    SELECT
      l.wallet as wallet,
      -- Lifetime
      l.total_trades,
      l.wins,
      l.losses,
      round(l.win_rate * 100, 2) as win_rate_pct,
      round(l.ev * 100, 4) as ev_pct,
      round(l.log_growth_per_trade * 100, 4) as log_growth_per_trade_pct,
      l.calendar_days,
      l.trading_days,
      round(l.trades_per_day, 2) as trades_per_day,
      round(l.trades_per_active_day, 2) as trades_per_active_day,
      round(l.log_return_pct_per_day, 4) as log_return_pct_per_day,
      round(l.log_return_pct_per_active_day, 4) as log_return_pct_per_active_day,
      round(l.ev_per_day, 4) as ev_per_day,
      round(l.ev_per_active_day, 4) as ev_per_active_day,
      round(l.mean_roi * 100, 4) as mean_roi_pct,
      round(l.volatility * 100, 4) as volatility_pct,
      round(l.downside_deviation * 100, 4) as downside_deviation_pct,
      round(l.sortino_ratio, 4) as sortino_ratio,
      round(l.quality_score, 4) as quality_score,
      round(l.total_pnl, 2) as total_pnl_usd,
      round(l.total_volume, 2) as total_volume_usd,
      l.markets_traded,
      l.first_trade,
      l.last_trade,
      round(l.avg_hold_time_minutes, 2) as avg_hold_time_minutes,
      -- 14d
      r14.total_trades_14d,
      r14.wins_14d,
      r14.losses_14d,
      round(r14.win_rate_14d * 100, 2) as win_rate_14d_pct,
      round(r14.ev_14d * 100, 4) as ev_14d_pct,
      round(r14.log_growth_per_trade_14d * 100, 4) as log_growth_per_trade_14d_pct,
      r14.calendar_days_14d,
      r14.trading_days_14d,
      round(r14.trades_per_day_14d, 2) as trades_per_day_14d,
      round(r14.trades_per_active_day_14d, 2) as trades_per_active_day_14d,
      round(r14.log_return_pct_per_day_14d, 4) as log_return_pct_per_day_14d,
      round(r14.log_return_pct_per_active_day_14d, 4) as log_return_pct_per_active_day_14d,
      round(r14.ev_per_day_14d, 4) as ev_per_day_14d,
      round(r14.ev_per_active_day_14d, 4) as ev_per_active_day_14d,
      round(r14.mean_roi_14d * 100, 4) as mean_roi_14d_pct,
      round(r14.volatility_14d * 100, 4) as volatility_14d_pct,
      round(r14.downside_deviation_14d * 100, 4) as downside_deviation_14d_pct,
      round(r14.sortino_ratio_14d, 4) as sortino_ratio_14d,
      round(r14.quality_score_14d, 4) as quality_score_14d,
      round(r14.total_pnl_14d, 2) as total_pnl_14d_usd,
      round(r14.total_volume_14d, 2) as total_volume_14d_usd,
      r14.markets_traded_14d,
      round(r14.avg_hold_time_minutes_14d, 2) as avg_hold_time_minutes_14d,
      -- 7d
      r7.total_trades_7d,
      r7.wins_7d,
      r7.losses_7d,
      round(r7.win_rate_7d * 100, 2) as win_rate_7d_pct,
      round(r7.ev_7d * 100, 4) as ev_7d_pct,
      round(r7.log_growth_per_trade_7d * 100, 4) as log_growth_per_trade_7d_pct,
      r7.calendar_days_7d,
      r7.trading_days_7d,
      round(r7.trades_per_day_7d, 2) as trades_per_day_7d,
      round(r7.trades_per_active_day_7d, 2) as trades_per_active_day_7d,
      round(r7.log_return_pct_per_day_7d, 4) as log_return_pct_per_day_7d,
      round(r7.log_return_pct_per_active_day_7d, 4) as log_return_pct_per_active_day_7d,
      round(r7.ev_per_day_7d, 4) as ev_per_day_7d,
      round(r7.ev_per_active_day_7d, 4) as ev_per_active_day_7d,
      round(r7.mean_roi_7d * 100, 4) as mean_roi_7d_pct,
      round(r7.volatility_7d * 100, 4) as volatility_7d_pct,
      round(r7.downside_deviation_7d * 100, 4) as downside_deviation_7d_pct,
      round(r7.sortino_ratio_7d, 4) as sortino_ratio_7d,
      round(r7.quality_score_7d, 4) as quality_score_7d,
      round(r7.total_pnl_7d, 2) as total_pnl_7d_usd,
      round(r7.total_volume_7d, 2) as total_volume_7d_usd,
      r7.markets_traded_7d,
      round(r7.avg_hold_time_minutes_7d, 2) as avg_hold_time_minutes_7d,
      -- Consistency
      least(l.quality_score, r14.quality_score_14d, r7.quality_score_7d) as consistency_score
    FROM tmp_custom_lifetime l
    INNER JOIN tmp_custom_14d r14 ON l.wallet = r14.wallet
    INNER JOIN tmp_custom_7d r7 ON l.wallet = r7.wallet
    ORDER BY r14.quality_score_14d DESC
  `);

  console.log(`  → ${finalData.length} wallets in final export\n`);

  // Export to CSV
  if (finalData.length > 0) {
    const headers = Object.keys(finalData[0]);
    const csvLines = [headers.join(',')];
    for (const row of finalData) {
      const values = headers.map((h) => {
        const v = row[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
        return String(v);
      });
      csvLines.push(values.join(','));
    }

    const outputPath = 'copy-trading-custom-export.csv';
    fs.writeFileSync(outputPath, csvLines.join('\n'));
    console.log(`Exported to ${outputPath}`);

    // Show top 10
    console.log('\n=== TOP 10 BY QUALITY SCORE 14D ===\n');
    console.log('Wallet                                     | Trades | Win% | EV%   | Quality 14d | Quality 7d | Consistency | PnL 14d');
    console.log('-------------------------------------------|--------|------|-------|-------------|------------|-------------|--------');
    finalData.slice(0, 10).forEach((w: any) => {
      console.log(
        `${w.wallet} | ${String(w.total_trades).padStart(6)} | ${String(w.win_rate_pct).padStart(4)} | ${String(w.ev_pct).padStart(5)} | ${String(w.quality_score_14d).padStart(11)} | ${String(w.quality_score_7d).padStart(10)} | ${String(w.consistency_score?.toFixed(2) || 'NULL').padStart(11)} | $${Number(w.total_pnl_14d_usd).toLocaleString()}`
      );
    });
  }

  // Cleanup
  console.log('\nCleaning up temp tables...');
  for (let i = 1; i <= 8; i++) {
    await execute(`DROP TABLE IF EXISTS tmp_custom_step${i}`);
  }
  await execute(`DROP TABLE IF EXISTS tmp_custom_lifetime`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_14d`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_7d`);

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  await client.close();
}

main().catch(console.error);
