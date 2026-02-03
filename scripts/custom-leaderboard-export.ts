#!/usr/bin/env npx tsx
/**
 * Custom Leaderboard Export - Active Days Based (v21.9)
 *
 * NOTE: Deduplication via GROUP BY tx_hash, wallet, condition_id, outcome_index
 * is applied at the metric calculation stage (not full-table) to avoid memory issues.
 * pm_trade_fifo_roi_v3_mat_unified is a computed FIFO output (not raw events).
 *
 * ALL TIME-BASED METRICS ARE CALCULATED OVER ACTIVE TRADING DAYS, NOT CALENDAR DAYS.
 * - "All time" = All active trading days in wallet history
 * - "14d" = Last 14 ACTIVE trading days (days with at least 1 trade)
 * - "7d" = Last 7 ACTIVE trading days (metrics only, not filtered)
 *
 * Filters (7 steps):
 * 1. Trading days > 5
 * 2. Markets > 8
 * 3. Trades > 30
 * 4. Buy trade in last 5 calendar days (recency check)
 * 5. Median bet > $10
 * 6. Log growth (all active days) > 0
 * 7. Log growth (last 14 active days) > 0
 *
 * Ranking: daily_log_growth_14d DESC (log_growth_per_trade × trades_per_active_day)
 *
 * Output: CSV with all metrics (all time, 14d, 7d)
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
  console.log('=== Custom Leaderboard Export v21.9 (7-Step Filter) ===\n');
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
  console.log(`  → ${step1[0].c.toLocaleString()} wallets\n`);

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
  console.log(`  → ${step2[0].c.toLocaleString()} wallets\n`);

  // Step 3: Wallets with > 30 trades
  // Note: Using count() for filtering (FIFO unified is computed output, minimal dups)
  // Full deduplication applied after Step 5 when calculating final metrics
  console.log('Step 3: Filtering to wallets with > 30 trades...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step3`);
  await execute(`
    CREATE TABLE tmp_custom_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, count() as total_trades
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_custom_step2)
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY wallet
    HAVING total_trades > 30
  `);
  const step3 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step3`);
  console.log(`  → ${step3[0].c.toLocaleString()} wallets\n`);

  // Step 4: Wallets with at least 1 buy trade in last 5 calendar days
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
  console.log(`  → ${step4[0].c.toLocaleString()} wallets\n`);

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
  const step5 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step5`);
  console.log(`  → ${step5[0].c.toLocaleString()} wallets\n`);

  // Create deduplicated table for qualifying wallets only (manageable size)
  console.log('Creating deduplicated table for qualifying wallets...');
  await execute(`DROP TABLE IF EXISTS tmp_fifo_deduped`);
  await execute(`
    CREATE TABLE tmp_fifo_deduped ENGINE = MergeTree() ORDER BY (wallet, entry_time) AS
    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      any(entry_time) as entry_time,
      any(resolved_at) as resolved_at,
      any(cost_usd) as cost_usd,
      any(pnl_usd) as pnl_usd,
      any(is_closed) as is_closed,
      any(is_short) as is_short
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_custom_step5)
      AND (resolved_at IS NOT NULL OR is_closed = 1)
      AND cost_usd > 0
    GROUP BY tx_hash, wallet, condition_id, outcome_index
  `);
  const dedupedCount = await query<{c: number}>(`SELECT count() as c FROM tmp_fifo_deduped`);
  console.log(`  → ${dedupedCount[0].c.toLocaleString()} deduplicated trades for ${step5[0].c.toLocaleString()} wallets\n`);

  // Build active days lookup tables
  console.log('Building active days lookup tables...');
  await execute(`DROP TABLE IF EXISTS tmp_wallet_active_dates`);
  await execute(`
    CREATE TABLE tmp_wallet_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT
      wallet,
      toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM tmp_fifo_deduped
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_last_14_active_days`);
  await execute(`
    CREATE TABLE tmp_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_last_7_active_days`);
  await execute(`
    CREATE TABLE tmp_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 7
  `);
  console.log('  → Active days lookup tables created\n');

  // Step 6: Log growth (all active days) > 0
  console.log('Step 6: Filtering to wallets with log growth (all active days) > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step6`);
  await execute(`
    CREATE TABLE tmp_custom_step6 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth
    FROM tmp_fifo_deduped t
    GROUP BY t.wallet
    HAVING log_growth > 0
  `);
  const step6 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step6`);
  console.log(`  → ${step6[0].c.toLocaleString()} wallets\n`);

  // Step 7: Log growth (last 14 active days) > 0
  console.log('Step 7: Filtering to wallets with log growth (last 14 active days) > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_custom_step7`);
  await execute(`
    CREATE TABLE tmp_custom_step7 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet as wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_14d
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_custom_step6 s ON t.wallet = s.wallet
    INNER JOIN tmp_last_14_active_days d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    GROUP BY t.wallet
    HAVING log_growth_14d > 0
  `);
  const step7 = await query<{c: number}>(`SELECT count() as c FROM tmp_custom_step7`);
  console.log(`  → ${step7[0].c.toLocaleString()} wallets (FINAL)\n`);

  // Calculate all metrics for final wallets
  console.log('Calculating all metrics for final wallets...');

  // Rebuild lookups for final wallets only
  await execute(`DROP TABLE IF EXISTS tmp_wallet_active_dates`);
  await execute(`
    CREATE TABLE tmp_wallet_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT
      wallet,
      toDate(entry_time) as trade_date,
      row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
    FROM tmp_fifo_deduped
    WHERE wallet IN (SELECT wallet FROM tmp_custom_step7)
    GROUP BY wallet, toDate(entry_time)
  `);

  await execute(`DROP TABLE IF EXISTS tmp_last_14_active_days`);
  await execute(`
    CREATE TABLE tmp_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 14
  `);

  await execute(`DROP TABLE IF EXISTS tmp_last_7_active_days`);
  await execute(`
    CREATE TABLE tmp_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
    SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 7
  `);

  // Lifetime percentiles (for winsorized metrics in output)
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_lifetime`);
  await execute(`
    CREATE TABLE tmp_custom_percentiles_lifetime ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, quantile(0.025)(pnl_usd / cost_usd) as p2_5, quantile(0.975)(pnl_usd / cost_usd) as p97_5
    FROM tmp_fifo_deduped
    WHERE wallet IN (SELECT wallet FROM tmp_custom_step7)
    GROUP BY wallet
  `);

  // Lifetime metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_lifetime`);
  await execute(`
    CREATE TABLE tmp_custom_lifetime ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      countIf(t.pnl_usd > 0) / count() as win_rate,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev,
      count() * avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) / nullIf(uniqExact(toDate(t.entry_time)) * 1440, 0) as capital_required,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
      uniqExact(toDate(t.entry_time)) as active_trading_days,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
      sum(t.pnl_usd) as total_pnl,
      sum(t.cost_usd) as total_volume,
      countDistinct(t.condition_id) as markets_traded,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade,
      avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) as avg_hold_time_minutes
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_custom_step7 s ON t.wallet = s.wallet
    INNER JOIN tmp_custom_percentiles_lifetime p ON t.wallet = p.wallet
    GROUP BY t.wallet
  `);

  // 14d percentiles
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_14d`);
  await execute(`
    CREATE TABLE tmp_custom_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.025)(t.pnl_usd / t.cost_usd) as p2_5, quantile(0.975)(t.pnl_usd / t.cost_usd) as p97_5
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_last_14_active_days d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE t.wallet IN (SELECT wallet FROM tmp_custom_step7)
    GROUP BY t.wallet
  `);

  // 14d metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_14d`);
  await execute(`
    CREATE TABLE tmp_custom_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      countIf(t.pnl_usd > 0) / count() as win_rate_14d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev_14d,
      count() * avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) / (14 * 1440) as capital_required_14d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
      uniqExact(toDate(t.entry_time)) as active_trading_days_14d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
      sum(t.pnl_usd) as total_pnl_14d,
      sum(t.cost_usd) as total_volume_14d,
      countDistinct(t.condition_id) as markets_traded_14d,
      avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) as avg_hold_time_minutes_14d
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_custom_step7 s ON t.wallet = s.wallet
    INNER JOIN tmp_last_14_active_days d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    INNER JOIN tmp_custom_percentiles_14d p ON t.wallet = p.wallet
    GROUP BY t.wallet
  `);

  // 7d percentiles
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_7d`);
  await execute(`
    CREATE TABLE tmp_custom_percentiles_7d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.025)(t.pnl_usd / t.cost_usd) as p2_5, quantile(0.975)(t.pnl_usd / t.cost_usd) as p97_5
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_last_7_active_days d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    WHERE t.wallet IN (SELECT wallet FROM tmp_custom_step7)
    GROUP BY t.wallet
  `);

  // 7d metrics
  await execute(`DROP TABLE IF EXISTS tmp_custom_7d`);
  await execute(`
    CREATE TABLE tmp_custom_7d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet as wallet,
      count() as total_trades_7d,
      countIf(t.pnl_usd > 0) as wins_7d,
      countIf(t.pnl_usd <= 0) as losses_7d,
      countIf(t.pnl_usd > 0) / count() as win_rate_7d,
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev_7d,
      count() * avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) / (7 * 1440) as capital_required_7d,
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
      uniqExact(toDate(t.entry_time)) as active_trading_days_7d,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
      sum(t.pnl_usd) as total_pnl_7d,
      sum(t.cost_usd) as total_volume_7d,
      countDistinct(t.condition_id) as markets_traded_7d,
      avg(CASE WHEN t.resolved_at < '1971-01-01' THEN NULL WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1 WHEN t.resolved_at < t.entry_time THEN NULL ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1) END) as avg_hold_time_minutes_7d
    FROM tmp_fifo_deduped t
    INNER JOIN tmp_custom_step7 s ON t.wallet = s.wallet
    INNER JOIN tmp_last_7_active_days d ON t.wallet = d.wallet AND toDate(t.entry_time) = d.trade_date
    INNER JOIN tmp_custom_percentiles_7d p ON t.wallet = p.wallet
    GROUP BY t.wallet
  `);

  // Final export query
  console.log('Exporting final data...');
  const finalData = await query<Record<string, any>>(`
    SELECT
      l.wallet as wallet,
      -- RANKING METRICS
      round(l.log_growth_per_trade * l.trades_per_active_day * 100, 4) as daily_log_growth_pct,
      round(r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d * 100, 4) as daily_log_growth_14d_pct,
      round(r7.log_growth_per_trade_7d * r7.trades_per_active_day_7d * 100, 4) as daily_log_growth_7d_pct,
      -- Winsorized ROC (metrics only, not filtered)
      round(l.winsorized_ev * l.total_trades / nullIf(l.capital_required, 0), 2) as winsorized_roc,
      round(r14.winsorized_ev_14d * r14.total_trades_14d / nullIf(r14.capital_required_14d, 0), 2) as winsorized_roc_14d,
      round(r7.winsorized_ev_7d * r7.total_trades_7d / nullIf(r7.capital_required_7d, 0), 2) as winsorized_roc_7d,
      -- Lifetime
      l.total_trades,
      l.wins,
      l.losses,
      round(l.win_rate * 100, 2) as win_rate_pct,
      round(l.ev * 100, 4) as ev_pct,
      round(l.winsorized_ev * 100, 4) as winsorized_ev_pct,
      round(l.log_growth_per_trade * 100, 4) as log_growth_per_trade_pct,
      l.active_trading_days,
      round(l.trades_per_active_day, 2) as trades_per_active_day,
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
      round(r14.winsorized_ev_14d * 100, 4) as winsorized_ev_14d_pct,
      round(r14.log_growth_per_trade_14d * 100, 4) as log_growth_per_trade_14d_pct,
      r14.active_trading_days_14d,
      round(r14.trades_per_active_day_14d, 2) as trades_per_active_day_14d,
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
      round(r7.winsorized_ev_7d * 100, 4) as winsorized_ev_7d_pct,
      round(r7.log_growth_per_trade_7d * 100, 4) as log_growth_per_trade_7d_pct,
      r7.active_trading_days_7d,
      round(r7.trades_per_active_day_7d, 2) as trades_per_active_day_7d,
      round(r7.total_pnl_7d, 2) as total_pnl_7d_usd,
      round(r7.total_volume_7d, 2) as total_volume_7d_usd,
      r7.markets_traded_7d,
      round(r7.avg_hold_time_minutes_7d, 2) as avg_hold_time_minutes_7d
    FROM tmp_custom_lifetime l
    INNER JOIN tmp_custom_14d r14 ON l.wallet = r14.wallet
    INNER JOIN tmp_custom_7d r7 ON l.wallet = r7.wallet
    ORDER BY r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d DESC
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = `exports/custom-leaderboard-v21.9-${timestamp}.csv`;

    // Ensure exports directory exists
    if (!fs.existsSync('exports')) {
      fs.mkdirSync('exports');
    }

    fs.writeFileSync(outputPath, csvLines.join('\n'));
    console.log(`Exported to ${outputPath}`);

    // Show top 10
    console.log('\n=== TOP 10 BY DAILY LOG GROWTH (LAST 14 ACTIVE DAYS) ===\n');
    console.log('Wallet                                     | DailyGrowth14d% | Win%14d | PnL 14d     | Trades14d');
    console.log('-------------------------------------------|-----------------|---------|-------------|----------');
    finalData.slice(0, 10).forEach((w: any) => {
      console.log(
        `${w.wallet} | ${String(w.daily_log_growth_14d_pct).padStart(15)} | ${String(w.win_rate_14d_pct).padStart(7)} | $${String(Number(w.total_pnl_14d_usd).toLocaleString()).padStart(10)} | ${String(w.total_trades_14d).padStart(9)}`
      );
    });
  }

  // Cleanup
  console.log('\nCleaning up temp tables...');
  await execute(`DROP TABLE IF EXISTS tmp_fifo_deduped`);
  for (let i = 1; i <= 7; i++) {
    await execute(`DROP TABLE IF EXISTS tmp_custom_step${i}`);
  }
  await execute(`DROP TABLE IF EXISTS tmp_wallet_active_dates`);
  await execute(`DROP TABLE IF EXISTS tmp_last_14_active_days`);
  await execute(`DROP TABLE IF EXISTS tmp_last_7_active_days`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_lifetime`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_lifetime`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_14d`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_14d`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_percentiles_7d`);
  await execute(`DROP TABLE IF EXISTS tmp_custom_7d`);

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  await client.close();
}

main().catch(console.error);
