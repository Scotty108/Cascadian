import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

/**
 * Copy Trading Leaderboard v24 - Cron Refresh
 *
 * Refreshes the copy trading leaderboard with validated metrics.
 * Schedule: Every 2 hours
 *
 * ALL TIME-BASED METRICS ARE CALCULATED OVER ACTIVE TRADING DAYS, NOT CALENDAR DAYS.
 * - "All time" = All active trading days in wallet history
 * - "14d" = Last 14 ACTIVE trading days (days with at least 1 trade)
 * - "7d" = Last 7 ACTIVE trading days (metrics only, not filtered)
 *
 * Filters (6 steps):
 * 1. Markets > 10 (unique markets traded)
 * 2. Buy trade in last 5 calendar days (recency check)
 * 3. Average bet > $10
 * 4. Log growth per trade (all time) > 10%
 * 5. Log growth per trade (last 14 active days) > 10%
 *
 * Winsorization: ROI values capped at 2.5th and 97.5th percentile per wallet
 *
 * Ranking: daily_log_growth_14d DESC (log_growth_per_trade_14d × trades_per_active_day_14d)
 * = Daily compound growth rate based on ACTIVE trading days
 *
 * @see docs/features/copytrading-leaderboard.md
 */

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
});

async function execute(sql: string): Promise<void> {
  await client.query({ query: sql });
}

async function queryCount(sql: string): Promise<number> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  const rows = (await result.json()) as { c: number }[];
  return rows[0]?.c ?? 0;
}

export const maxDuration = 600; // 10 minutes (Vercel Pro limit)

export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret (optional but recommended)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const steps: { step: string; count: number; durationMs: number }[] = [];
    let stepStart = Date.now();

    // Step 1: Wallets with > 10 unique markets
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step1`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_step1 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT wallet, countDistinct(condition_id) as markets_traded
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet
      HAVING markets_traded > 10
    `);
    let count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_step1`);
    steps.push({ step: 'Markets > 10', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 2: Wallets with buy trade in last 5 days
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step2`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_step2 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT DISTINCT t.wallet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_step1 s ON t.wallet = s.wallet
      WHERE t.entry_time >= now() - INTERVAL 5 DAY
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_step2`);
    steps.push({ step: 'Buy trade last 5 days', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 3: Wallets with average bet > $10
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step3`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_step3 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, avg(t.cost_usd) as avg_bet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_step2 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING avg_bet > 10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_step3`);
    steps.push({ step: 'Average bet > $10', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 4: Wallets with log growth per trade (all time) > 10%
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step4`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_step4 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_step3 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING log_growth_per_trade > 0.10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_step4`);
    steps.push({ step: 'Log growth (all time) > 10%', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Create active days lookup table for Step 5 and metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v24_step4)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet, toDate(entry_time)
    `);

    // Create last 14 active days lookup
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date
      FROM tmp_copytrade_v24_active_dates
      WHERE date_rank <= 14
    `);

    // Create last 7 active days lookup
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date
      FROM tmp_copytrade_v24_active_dates
      WHERE date_rank <= 7
    `);

    // Step 5: Wallets with log growth per trade (14d) > 10%
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step5`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_step5 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v24_step4 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING log_growth_per_trade_14d > 0.10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_step5`);
    steps.push({ step: 'Log growth (14d) > 10%', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // ========== CALCULATE ALL METRICS FOR FINAL WALLETS ==========

    // Rebuild active days lookups for final wallets only
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v24_step5)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet, toDate(entry_time)
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v24_active_dates WHERE date_rank <= 14
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v24_active_dates WHERE date_rank <= 7
    `);

    // Lifetime percentiles (for winsorized metrics)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_percentiles_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        wallet,
        quantile(0.025)(pnl_usd / cost_usd) as roi_floor,
        quantile(0.975)(pnl_usd / cost_usd) as roi_ceiling
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v24_step5)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet
    `);

    // Lifetime metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades,
        countIf(t.pnl_usd > 0) as wins,
        countIf(t.pnl_usd <= 0) as losses,
        countIf(t.pnl_usd > 0) / count() as win_rate,
        -- Standard EV
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
        -- Winsorized EV (ROI capped at 2.5% and 97.5% percentiles)
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd <= 0)), 0) as winsorized_ev,
        -- ROI percentile bounds
        any(p.roi_floor) as roi_floor,
        any(p.roi_ceiling) as roi_ceiling,
        -- Log growth per trade
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
        -- Day counts
        dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
        uniqExact(toDate(t.entry_time)) as trading_days,
        count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
        -- PnL and volume
        sum(t.pnl_usd) as total_pnl,
        sum(t.cost_usd) as total_volume,
        countDistinct(t.condition_id) as markets_traded,
        avg(t.cost_usd) as avg_bet_size,
        quantile(0.5)(t.cost_usd) as median_bet_size,
        min(t.entry_time) as first_trade,
        max(t.entry_time) as last_trade,
        -- Hold time
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_step5 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v24_percentiles_lifetime p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_lifetime`);
    steps.push({ step: 'Lifetime metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 14d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_14d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (SELECT wallet FROM tmp_copytrade_v24_step5)
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);

    // 14-day metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_14d,
        countIf(t.pnl_usd > 0) as wins_14d,
        countIf(t.pnl_usd <= 0) as losses_14d,
        countIf(t.pnl_usd > 0) / count() as win_rate_14d,
        -- Standard EV 14d
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
        -- Winsorized EV 14d
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd <= 0)), 0) as winsorized_ev_14d,
        -- ROI percentile bounds 14d
        any(p.roi_floor_14d) as roi_floor_14d,
        any(p.roi_ceiling_14d) as roi_ceiling_14d,
        -- Log growth per trade 14d
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
        -- Day counts
        uniqExact(toDate(t.entry_time)) as trading_days_14d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
        -- PnL and volume 14d
        sum(t.pnl_usd) as total_pnl_14d,
        sum(t.cost_usd) as total_volume_14d,
        countDistinct(t.condition_id) as markets_traded_14d,
        avg(t.cost_usd) as avg_bet_size_14d,
        -- Hold time 14d
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v24_step5 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v24_percentiles_14d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_14d`);
    steps.push({ step: '14-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 7d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_percentiles_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_7d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (SELECT wallet FROM tmp_copytrade_v24_step5)
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);

    // 7-day metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v24_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_7d,
        countIf(t.pnl_usd > 0) as wins_7d,
        countIf(t.pnl_usd <= 0) as losses_7d,
        countIf(t.pnl_usd > 0) / count() as win_rate_7d,
        -- Standard EV 7d
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
        -- Winsorized EV 7d
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd <= 0)), 0) as winsorized_ev_7d,
        -- ROI percentile bounds 7d
        any(p.roi_floor_7d) as roi_floor_7d,
        any(p.roi_ceiling_7d) as roi_ceiling_7d,
        -- Log growth per trade 7d
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
        -- Day counts
        uniqExact(toDate(t.entry_time)) as trading_days_7d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
        -- PnL and volume 7d
        sum(t.pnl_usd) as total_pnl_7d,
        sum(t.cost_usd) as total_volume_7d,
        countDistinct(t.condition_id) as markets_traded_7d,
        -- Hold time 7d
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v24_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v24_step5 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v24_percentiles_7d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v24_7d`);
    steps.push({ step: '7-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Final table: Join into leaderboard
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v24_new`);
    await execute(`
      CREATE TABLE pm_copy_trading_leaderboard_v24_new ENGINE = ReplacingMergeTree() ORDER BY wallet AS
      SELECT
        l.wallet,
        -- RANKING METRIC: Daily Log Growth based on ACTIVE days
        -- (log_growth_per_trade × trades_per_active_day)
        l.log_growth_per_trade * l.trades_per_active_day as daily_log_growth,
        r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d as daily_log_growth_14d,
        r7.log_growth_per_trade_7d * r7.trades_per_active_day_7d as daily_log_growth_7d,
        -- Lifetime
        l.total_trades,
        l.wins,
        l.losses,
        l.win_rate,
        l.ev,
        l.winsorized_ev,
        l.roi_floor,
        l.roi_ceiling,
        l.log_growth_per_trade,
        l.calendar_days,
        l.trading_days,
        l.trades_per_day,
        l.trades_per_active_day,
        l.total_pnl,
        l.total_volume,
        l.markets_traded,
        l.avg_bet_size,
        l.median_bet_size,
        l.first_trade,
        l.last_trade,
        l.avg_hold_time_minutes,
        -- 14d
        coalesce(r14.total_trades_14d, 0) as total_trades_14d,
        coalesce(r14.wins_14d, 0) as wins_14d,
        coalesce(r14.losses_14d, 0) as losses_14d,
        coalesce(r14.win_rate_14d, 0) as win_rate_14d,
        coalesce(r14.ev_14d, 0) as ev_14d,
        coalesce(r14.winsorized_ev_14d, 0) as winsorized_ev_14d,
        r14.roi_floor_14d,
        r14.roi_ceiling_14d,
        coalesce(r14.log_growth_per_trade_14d, 0) as log_growth_per_trade_14d,
        coalesce(r14.trading_days_14d, 0) as trading_days_14d,
        coalesce(r14.trades_per_active_day_14d, 0) as trades_per_active_day_14d,
        coalesce(r14.total_pnl_14d, 0) as total_pnl_14d,
        coalesce(r14.total_volume_14d, 0) as total_volume_14d,
        coalesce(r14.markets_traded_14d, 0) as markets_traded_14d,
        r14.avg_bet_size_14d,
        r14.avg_hold_time_minutes_14d,
        -- 7d
        coalesce(r7.total_trades_7d, 0) as total_trades_7d,
        coalesce(r7.wins_7d, 0) as wins_7d,
        coalesce(r7.losses_7d, 0) as losses_7d,
        coalesce(r7.win_rate_7d, 0) as win_rate_7d,
        coalesce(r7.ev_7d, 0) as ev_7d,
        coalesce(r7.winsorized_ev_7d, 0) as winsorized_ev_7d,
        r7.roi_floor_7d,
        r7.roi_ceiling_7d,
        coalesce(r7.log_growth_per_trade_7d, 0) as log_growth_per_trade_7d,
        coalesce(r7.trading_days_7d, 0) as trading_days_7d,
        coalesce(r7.trades_per_active_day_7d, 0) as trades_per_active_day_7d,
        coalesce(r7.total_pnl_7d, 0) as total_pnl_7d,
        coalesce(r7.total_volume_7d, 0) as total_volume_7d,
        coalesce(r7.markets_traded_7d, 0) as markets_traded_7d,
        r7.avg_hold_time_minutes_7d,
        now() as refreshed_at
      FROM tmp_copytrade_v24_lifetime l
      INNER JOIN tmp_copytrade_v24_14d r14 ON l.wallet = r14.wallet
      INNER JOIN tmp_copytrade_v24_7d r7 ON l.wallet = r7.wallet
    `);

    // Atomic swap
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v24_old`);
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v24 TO pm_copy_trading_leaderboard_v24_old`).catch(() => {});
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v24_new TO pm_copy_trading_leaderboard_v24`);
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v24_old`);

    count = await queryCount(`SELECT count() as c FROM pm_copy_trading_leaderboard_v24`);
    steps.push({ step: 'Final leaderboard', count, durationMs: Date.now() - stepStart });

    // Cleanup temp tables
    for (let i = 1; i <= 5; i++) {
      await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_step${i}`);
    }
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_active_dates`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_14_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_last_7_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_percentiles_7d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v24_7d`);

    const totalDuration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      version: '24',
      wallets: count,
      steps,
      totalDurationMs: totalDuration,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Leaderboard refresh failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    await client.close();
  }
}
