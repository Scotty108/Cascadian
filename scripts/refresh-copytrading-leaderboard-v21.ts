#!/usr/bin/env npx tsx
/**
 * Copy Trading Leaderboard v21
 *
 * CHANGES FROM v20:
 * - Added log_return_pct_per_active_day (uses actual trading days, not calendar span)
 * - Added trading_days (count of distinct days with trades)
 * - Added 14-day recency metrics for all key metrics
 *
 * FILTERS APPLIED (in order of compute cost):
 * 1. Active in last 3 days (at least 1 trade)
 * 2. Wallet age ≥ 8 days (first trade > 8 days ago)
 * 3. Market diversity ≥ 8 distinct markets
 * 4. Trade count > 50 trades
 * 5. Median bet size ≥ $10
 * 6. Median ROI ≥ 5% (using pnl_usd/cost_usd, NOT the broken roi column)
 * 7. EV > 0 (expected value positive)
 *
 * METRICS CALCULATED (Lifetime):
 * - EV % = (win_rate × median_win_roi) - (loss_rate × |median_loss_roi|)
 * - Log Growth Per Trade = avg(ln(1 + ROI))
 * - Trades Per Day = total_trades / calendar_days
 * - Trades Per Active Day = total_trades / trading_days
 * - Log Return %/Day = log_growth_per_trade × trades_per_day × 100
 * - Log Return %/Active Day = log_growth_per_trade × trades_per_active_day × 100 (NEW)
 * - EV Per Day % = EV × trades_per_day × 100
 *
 * METRICS CALCULATED (14-Day):
 * - All of the above, but only for trades in the last 14 days
 *
 * @see docs/COPYTRADING_LEADERBOARD_METHODOLOGY.md
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
});

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.query({ query: sql });
}

async function refreshLeaderboard(): Promise<void> {
  console.log('=== Copy Trading Leaderboard v21 ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Step 1: Create temp table with wallets active in last 3 days
  console.log('Step 1: Finding wallets active in last 3 days...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step1`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step1 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT DISTINCT wallet
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE entry_time >= now() - INTERVAL 3 DAY
  `);
  const step1 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step1`);
  console.log(`  → ${step1[0].c.toLocaleString()} wallets active in last 3 days\n`);

  // Step 2: Filter to wallets ≥ 8 days old
  console.log('Step 2: Filtering to wallets ≥ 8 days old...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step2`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step2 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, min(entry_time) as first_trade
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v21_step1)
    GROUP BY wallet
    HAVING first_trade <= now() - INTERVAL 8 DAY
  `);
  const step2 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step2`);
  console.log(`  → ${step2[0].c.toLocaleString()} wallets ≥ 8 days old\n`);

  // Step 3: Filter to wallets with ≥ 8 distinct markets
  console.log('Step 3: Filtering to wallets with ≥ 8 markets...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step3`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, countDistinct(condition_id) as markets_traded
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v21_step2)
    GROUP BY wallet
    HAVING markets_traded >= 8
  `);
  const step3 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step3`);
  console.log(`  → ${step3[0].c.toLocaleString()} wallets with ≥ 8 markets\n`);

  // Step 4: Filter to wallets with > 50 trades
  console.log('Step 4: Filtering to wallets with > 50 trades...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step4`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step4 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, count() as total_trades
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step3 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING total_trades > 50
  `);
  const step4 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step4`);
  console.log(`  → ${step4[0].c.toLocaleString()} wallets with > 50 trades\n`);

  // Step 5: Filter to wallets with median bet ≥ $10
  console.log('Step 5: Filtering to wallets with median bet ≥ $10...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step5`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step5 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.5)(t.cost_usd) as median_bet_size
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step4 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING median_bet_size >= 10
  `);
  const step5 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step5`);
  console.log(`  → ${step5[0].c.toLocaleString()} wallets with median bet ≥ $10\n`);

  // Step 6: Filter to wallets with median ROI ≥ 5%
  console.log('Step 6: Filtering to wallets with median ROI ≥ 5%...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step6`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step6 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.5)(t.pnl_usd / t.cost_usd) as median_roi
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step5 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING median_roi >= 0.05
  `);
  const step6 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step6`);
  console.log(`  → ${step6[0].c.toLocaleString()} wallets with median ROI ≥ 5%\n`);

  // Step 7: Filter to wallets with EV > 0
  console.log('Step 7: Filtering to wallets with EV > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step7`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_step7 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)) as ev
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step6 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING ev > 0 OR countIf(t.pnl_usd <= 0) = 0
  `);
  const step7 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_step7`);
  console.log(`  → ${step7[0].c.toLocaleString()} wallets with EV > 0\n`);

  // Step 8: Calculate final metrics for all qualifying wallets
  console.log('Step 8: Calculating lifetime metrics...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_lifetime`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_lifetime ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,

      -- Trade counts
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      countIf(t.pnl_usd > 0) / count() as win_rate,

      -- EV = (win_rate × median_win_roi) - (loss_rate × |median_loss_roi|)
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)) as ev,

      -- Log Growth Per Trade = avg(ln(1 + ROI))
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,

      -- Day counts
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
      uniqExact(toDate(t.entry_time)) as trading_days,

      -- Trades per day (both methods)
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
      count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,

      -- Log Return %/Day (calendar method)
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as log_return_pct_per_day,

      -- Log Return %/Active Day (actual trading days method) - NEW
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / uniqExact(toDate(t.entry_time)))
        * 100 as log_return_pct_per_active_day,

      -- EV Per Day = EV × trades_per_day × 100
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as ev_per_day,

      -- PnL and volume
      sum(t.pnl_usd) as total_pnl,
      sum(t.cost_usd) as total_volume,
      countDistinct(t.condition_id) as markets_traded,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade

    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step7 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);
  const step8 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_lifetime`);
  console.log(`  → ${step8[0].c.toLocaleString()} wallets with lifetime metrics\n`);

  // Step 9: Calculate 14-day metrics
  console.log('Step 9: Calculating 14-day metrics...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_14d`);
  await execute(`
    CREATE TABLE tmp_copytrade_v21_14d ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,

      -- Trade counts (14d)
      count() as total_trades_14d,
      countIf(t.pnl_usd > 0) as wins_14d,
      countIf(t.pnl_usd <= 0) as losses_14d,
      if(count() > 0, countIf(t.pnl_usd > 0) / count(), 0) as win_rate_14d,

      -- EV (14d)
      if(count() > 0 AND countIf(t.pnl_usd > 0) > 0,
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)),
        0) as ev_14d,

      -- Log Growth Per Trade (14d)
      if(count() > 0, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))), 0) as log_growth_per_trade_14d,

      -- Day counts (14d)
      if(count() > 0, dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1, 0) as calendar_days_14d,
      uniqExact(toDate(t.entry_time)) as trading_days_14d,

      -- Trades per day (14d)
      if(count() > 0, count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1), 0) as trades_per_day_14d,
      if(uniqExact(toDate(t.entry_time)) > 0, count() / uniqExact(toDate(t.entry_time)), 0) as trades_per_active_day_14d,

      -- Log Return %/Day (14d, calendar)
      if(count() > 0,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
          * 100,
        0) as log_return_pct_per_day_14d,

      -- Log Return %/Active Day (14d)
      if(uniqExact(toDate(t.entry_time)) > 0,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / uniqExact(toDate(t.entry_time)))
          * 100,
        0) as log_return_pct_per_active_day_14d,

      -- EV Per Day (14d)
      if(count() > 0 AND countIf(t.pnl_usd > 0) > 0,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)))
          * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
          * 100,
        0) as ev_per_day_14d,

      -- PnL and volume (14d)
      sum(t.pnl_usd) as total_pnl_14d,
      sum(t.cost_usd) as total_volume_14d,
      countDistinct(t.condition_id) as markets_traded_14d

    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_v21_step7 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
      AND t.entry_time >= now() - INTERVAL 14 DAY
    GROUP BY t.wallet
  `);
  const step9 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_v21_14d`);
  console.log(`  → ${step9[0].c.toLocaleString()} wallets with 14-day activity\n`);

  // Step 10: Join lifetime and 14d metrics into final table
  console.log('Step 10: Creating final leaderboard table...');
  await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_new`);
  await execute(`
    CREATE TABLE pm_copy_trading_leaderboard_v21_new ENGINE = ReplacingMergeTree() ORDER BY wallet AS
    SELECT
      l.wallet,

      -- Lifetime metrics
      l.total_trades,
      l.wins,
      l.losses,
      l.win_rate,
      l.ev,
      l.log_growth_per_trade,
      l.calendar_days,
      l.trading_days,
      l.trades_per_day,
      l.trades_per_active_day,
      l.log_return_pct_per_day,
      l.log_return_pct_per_active_day,
      l.ev_per_day,
      l.total_pnl,
      l.total_volume,
      l.markets_traded,
      l.first_trade,
      l.last_trade,

      -- 14-day metrics
      coalesce(r.total_trades_14d, 0) as total_trades_14d,
      coalesce(r.wins_14d, 0) as wins_14d,
      coalesce(r.losses_14d, 0) as losses_14d,
      coalesce(r.win_rate_14d, 0) as win_rate_14d,
      coalesce(r.ev_14d, 0) as ev_14d,
      coalesce(r.log_growth_per_trade_14d, 0) as log_growth_per_trade_14d,
      coalesce(r.calendar_days_14d, 0) as calendar_days_14d,
      coalesce(r.trading_days_14d, 0) as trading_days_14d,
      coalesce(r.trades_per_day_14d, 0) as trades_per_day_14d,
      coalesce(r.trades_per_active_day_14d, 0) as trades_per_active_day_14d,
      coalesce(r.log_return_pct_per_day_14d, 0) as log_return_pct_per_day_14d,
      coalesce(r.log_return_pct_per_active_day_14d, 0) as log_return_pct_per_active_day_14d,
      coalesce(r.ev_per_day_14d, 0) as ev_per_day_14d,
      coalesce(r.total_pnl_14d, 0) as total_pnl_14d,
      coalesce(r.total_volume_14d, 0) as total_volume_14d,
      coalesce(r.markets_traded_14d, 0) as markets_traded_14d,

      now() as refreshed_at

    FROM tmp_copytrade_v21_lifetime l
    LEFT JOIN tmp_copytrade_v21_14d r ON l.wallet = r.wallet
  `);

  // Atomic swap
  await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_old`);
  await execute(`RENAME TABLE pm_copy_trading_leaderboard_v21 TO pm_copy_trading_leaderboard_v21_old`).catch(() => {});
  await execute(`RENAME TABLE pm_copy_trading_leaderboard_v21_new TO pm_copy_trading_leaderboard_v21`);
  await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_old`);

  const finalCount = await query<{c: number}>(`SELECT count() as c FROM pm_copy_trading_leaderboard_v21`);
  console.log(`  → ${finalCount[0].c.toLocaleString()} wallets in final leaderboard\n`);

  // Cleanup temp tables
  console.log('Cleaning up temp tables...');
  for (let i = 1; i <= 7; i++) {
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step${i}`);
  }
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_lifetime`);
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_14d`);

  // Show top 10 by EV per active day
  console.log('\n=== TOP 10 BY LOG RETURN %/ACTIVE DAY ===\n');
  const top10 = await query<any>(`
    SELECT
      wallet,
      total_trades,
      round(win_rate * 100, 1) as win_rate_pct,
      round(ev * 100, 2) as ev_pct,
      trading_days,
      round(trades_per_active_day, 1) as trades_per_active_day,
      round(log_return_pct_per_active_day, 2) as log_ret_active,
      round(log_return_pct_per_day, 2) as log_ret_calendar,
      round(total_pnl, 2) as total_pnl,
      total_trades_14d,
      round(win_rate_14d * 100, 1) as win_rate_14d_pct,
      round(ev_14d * 100, 2) as ev_14d_pct,
      round(log_return_pct_per_active_day_14d, 2) as log_ret_active_14d,
      round(total_pnl_14d, 2) as pnl_14d
    FROM pm_copy_trading_leaderboard_v21
    WHERE log_return_pct_per_active_day > 0
    ORDER BY log_return_pct_per_active_day DESC
    LIMIT 10
  `);

  console.log('Wallet                                     | Trades | Win%  | EV%   | TradeDays | Trades/Day | LogRet%/Active | LogRet%/Cal | PnL       | 14d Trades | 14d Win% | 14d EV% | 14d LogRet% | 14d PnL');
  console.log('-------------------------------------------|--------|-------|-------|-----------|------------|----------------|-------------|-----------|------------|----------|---------|-------------|--------');

  top10.forEach((w: any) => {
    console.log(
      `${w.wallet} | ${String(w.total_trades).padStart(6)} | ${String(w.win_rate_pct).padStart(5)} | ${String(w.ev_pct).padStart(5)} | ${String(w.trading_days).padStart(9)} | ${String(w.trades_per_active_day).padStart(10)} | ${String(w.log_ret_active).padStart(14)} | ${String(w.log_ret_calendar).padStart(11)} | $${w.total_pnl.toLocaleString().padStart(8)} | ${String(w.total_trades_14d).padStart(10)} | ${String(w.win_rate_14d_pct).padStart(8)} | ${String(w.ev_14d_pct).padStart(7)} | ${String(w.log_ret_active_14d).padStart(11)} | $${w.pnl_14d.toLocaleString()}`
    );
  });

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log(`\nLeaderboard saved to: pm_copy_trading_leaderboard_v21`);

  await client.close();
}

refreshLeaderboard().catch(console.error);
