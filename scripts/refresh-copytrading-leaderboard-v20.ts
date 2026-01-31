#!/usr/bin/env npx tsx
/**
 * Copy Trading Leaderboard v20
 *
 * Refreshes the copy trading leaderboard daily with validated metrics.
 *
 * FILTERS APPLIED (in order of compute cost):
 * 1. Active in last 5 days (at least 1 trade)
 * 2. Wallet age ≥ 8 days (first trade > 8 days ago)
 * 3. Market diversity ≥ 8 distinct markets
 * 4. Trade count > 50 trades
 * 5. Median bet size ≥ $10
 * 6. Median ROI ≥ 5% (using pnl_usd/cost_usd, NOT the broken roi column)
 * 7. EV > 0 (expected value positive)
 * 8. Total PnL ≥ 0 (lifetime profitable)
 *
 * METRICS CALCULATED:
 * - EV % = (win_rate × median_win_roi) - (loss_rate × |median_loss_roi|)
 * - Log Growth Per Trade = avg(ln(1 + pnl_usd/cost_usd))
 * - Trades Per Day = total_trades / active_days
 * - Log Return %/Day = log_growth_per_trade × trades_per_day × 100
 * - EV Per Day % = EV × trades_per_day × 100
 *
 * IMPORTANT NOTES:
 * - Uses pnl_usd/cost_usd as TRUE ROI (the stored 'roi' column is broken for NO positions)
 * - is_short=1 means "bought NO tokens" not actual shorting (Polymarket doesn't have shorting)
 * - Deduplication via GROUP BY tx_hash, wallet, condition_id, outcome_index
 * - Only includes realized PnL: (resolved_at IS NOT NULL OR is_closed = 1)
 *
 * @see docs/COPYTRADING_LEADERBOARD_METHODOLOGY.md for full documentation
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

interface LeaderboardWallet {
  wallet: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  ev: number;
  log_growth_per_trade: number;
  trades_per_day: number;
  log_return_pct_per_day: number;
  ev_per_day: number;
  active_days: number;
  total_pnl: number;
  total_volume: number;
  first_trade: string;
  last_trade: string;
}

async function refreshLeaderboard(): Promise<void> {
  console.log('=== Copy Trading Leaderboard v20 ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Step 1: Create temp table with wallets active in last 5 days
  console.log('Step 1: Finding wallets active in last 5 days...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step1`);
  await execute(`
    CREATE TABLE tmp_copytrade_step1 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT DISTINCT wallet
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE entry_time >= now() - INTERVAL 5 DAY
  `);
  const step1 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step1`);
  console.log(`  → ${step1[0].c.toLocaleString()} wallets active in last 5 days\n`);

  // Step 2: Filter to wallets ≥ 8 days old
  console.log('Step 2: Filtering to wallets ≥ 8 days old...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step2`);
  await execute(`
    CREATE TABLE tmp_copytrade_step2 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, min(entry_time) as first_trade
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_copytrade_step1)
    GROUP BY wallet
    HAVING first_trade <= now() - INTERVAL 8 DAY
  `);
  const step2 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step2`);
  console.log(`  → ${step2[0].c.toLocaleString()} wallets ≥ 8 days old\n`);

  // Step 3: Filter to wallets with ≥ 8 distinct markets
  console.log('Step 3: Filtering to wallets with ≥ 8 markets...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step3`);
  await execute(`
    CREATE TABLE tmp_copytrade_step3 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT wallet, countDistinct(condition_id) as markets_traded
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE wallet IN (SELECT wallet FROM tmp_copytrade_step2)
    GROUP BY wallet
    HAVING markets_traded >= 8
  `);
  const step3 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step3`);
  console.log(`  → ${step3[0].c.toLocaleString()} wallets with ≥ 8 markets\n`);

  // Step 4: Filter to wallets with > 50 trades
  console.log('Step 4: Filtering to wallets with > 50 trades...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step4`);
  await execute(`
    CREATE TABLE tmp_copytrade_step4 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, count() as total_trades
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step3 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING total_trades > 50
  `);
  const step4 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step4`);
  console.log(`  → ${step4[0].c.toLocaleString()} wallets with > 50 trades\n`);

  // Step 5: Filter to wallets with median bet ≥ $10
  console.log('Step 5: Filtering to wallets with median bet ≥ $10...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step5`);
  await execute(`
    CREATE TABLE tmp_copytrade_step5 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.5)(t.cost_usd) as median_bet_size
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step4 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING median_bet_size >= 10
  `);
  const step5 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step5`);
  console.log(`  → ${step5[0].c.toLocaleString()} wallets with median bet ≥ $10\n`);

  // Step 6: Filter to wallets with median ROI ≥ 5%
  console.log('Step 6: Filtering to wallets with median ROI ≥ 5%...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step6`);
  await execute(`
    CREATE TABLE tmp_copytrade_step6 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, quantile(0.5)(t.pnl_usd / t.cost_usd) as median_roi
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step5 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING median_roi >= 0.05
  `);
  const step6 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step6`);
  console.log(`  → ${step6[0].c.toLocaleString()} wallets with median ROI ≥ 5%\n`);

  // Step 7: Filter to wallets with EV > 0
  console.log('Step 7: Filtering to wallets with EV > 0...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step7`);
  await execute(`
    CREATE TABLE tmp_copytrade_step7 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)) as ev
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step6 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING ev > 0 OR countIf(t.pnl_usd <= 0) = 0
  `);
  const step7 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step7`);
  console.log(`  → ${step7[0].c.toLocaleString()} wallets with EV > 0\n`);

  // Step 8: Filter to wallets with Total PnL ≥ 0
  console.log('Step 8: Filtering to wallets with Total PnL ≥ 0...');
  await execute(`DROP TABLE IF EXISTS tmp_copytrade_step8`);
  await execute(`
    CREATE TABLE tmp_copytrade_step8 ENGINE = MergeTree() ORDER BY wallet AS
    SELECT t.wallet, sum(t.pnl_usd) as total_pnl
    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step7 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
    HAVING total_pnl >= 0
  `);
  const step8 = await query<{c: number}>(`SELECT count() as c FROM tmp_copytrade_step8`);
  console.log(`  → ${step8[0].c.toLocaleString()} wallets with Total PnL ≥ 0\n`);

  // Step 9: Calculate final metrics for all qualifying wallets
  console.log('Step 9: Calculating final metrics...');
  await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v20`);
  await execute(`
    CREATE TABLE pm_copy_trading_leaderboard_v20 ENGINE = ReplacingMergeTree() ORDER BY wallet AS
    SELECT
      t.wallet,
      count() as total_trades,
      countIf(t.pnl_usd > 0) as wins,
      countIf(t.pnl_usd <= 0) as losses,
      countIf(t.pnl_usd > 0) / count() as win_rate,

      -- EV = (win_rate × median_win_roi) - (loss_rate × |median_loss_roi|)
      (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)) as ev,

      -- Log Growth Per Trade = avg(ln(1 + ROI))
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,

      -- Trades Per Day
      count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,

      -- Log Return %/Day = log_growth_per_trade × trades_per_day × 100
      avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as log_return_pct_per_day,

      -- EV Per Day = EV × trades_per_day × 100
      ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
      - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)))
        * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
        * 100 as ev_per_day,

      -- Additional context
      dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as active_days,
      sum(t.pnl_usd) as total_pnl,
      sum(t.cost_usd) as total_volume,
      min(t.entry_time) as first_trade,
      max(t.entry_time) as last_trade,
      now() as refreshed_at

    FROM pm_trade_fifo_roi_v3_mat_unified t
    INNER JOIN tmp_copytrade_step8 s ON t.wallet = s.wallet
    WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
      AND t.cost_usd > 0
    GROUP BY t.wallet
  `);
  const step9 = await query<{c: number}>(`SELECT count() as c FROM pm_copy_trading_leaderboard_v20`);
  console.log(`  → ${step9[0].c.toLocaleString()} wallets in final leaderboard\n`);

  // Cleanup temp tables
  console.log('Cleaning up temp tables...');
  for (let i = 1; i <= 8; i++) {
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_step${i}`);
  }

  // Show top 10 by EV per day
  console.log('\n=== TOP 10 BY EV PER DAY ===\n');
  const top10 = await query<LeaderboardWallet>(`
    SELECT
      wallet,
      total_trades,
      wins,
      losses,
      round(win_rate * 100, 1) as win_rate,
      round(ev * 100, 2) as ev,
      round(log_growth_per_trade * 100, 4) as log_growth_per_trade,
      round(trades_per_day, 1) as trades_per_day,
      round(log_return_pct_per_day, 2) as log_return_pct_per_day,
      round(ev_per_day, 2) as ev_per_day,
      active_days,
      round(total_pnl, 2) as total_pnl,
      round(total_volume, 2) as total_volume,
      toString(first_trade) as first_trade,
      toString(last_trade) as last_trade
    FROM pm_copy_trading_leaderboard_v20
    ORDER BY ev_per_day DESC
    LIMIT 10
  `);

  console.log('Rank | Wallet                                     | EV/Day%  | EV%   | Trades/Day | LogRet%/Day | Win%  | PnL');
  console.log('-----|--------------------------------------------|---------:|------:|-----------:|------------:|------:|------------');

  top10.forEach((w, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${w.wallet} | ${String(w.ev_per_day).padStart(8)} | ${String(w.ev).padStart(5)} | ${String(w.trades_per_day).padStart(10)} | ${String(w.log_return_pct_per_day).padStart(11)} | ${String(w.win_rate).padStart(5)} | $${w.total_pnl.toLocaleString()}`
    );
  });

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log(`\nLeaderboard saved to: pm_copy_trading_leaderboard_v20`);

  await client.close();
}

refreshLeaderboard().catch(console.error);
