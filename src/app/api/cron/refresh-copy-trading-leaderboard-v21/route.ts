import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

/**
 * Copy Trading Leaderboard v21.8 - Cron Refresh
 *
 * Refreshes the copy trading leaderboard with validated metrics.
 * Schedule: Daily at 6am UTC
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
 * Ranking: daily_log_growth_14d DESC (log_growth_per_trade_14d × trades_per_active_day_14d)
 * = Daily compound growth rate based on ACTIVE trading days
 *
 * @see docs/COPYTRADING_LEADERBOARD_METHODOLOGY.md
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

    // Step 1: Wallets with > 5 trading days
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step1`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step1 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT wallet, uniqExact(toDate(entry_time)) as trading_days
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet
      HAVING trading_days > 5
    `);
    let count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step1`);
    steps.push({ step: 'Trading days > 5', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 2: Wallets with > 8 markets
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step2`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step2 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, countDistinct(t.condition_id) as markets_traded
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step1 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING markets_traded > 8
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step2`);
    steps.push({ step: 'Markets > 8', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 3: Wallets with > 30 trades
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step3`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step3 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, count() as total_trades
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step2 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING total_trades > 30
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step3`);
    steps.push({ step: 'Trades > 30', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 4: Wallets with at least 1 buy trade in last 5 days
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step4`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step4 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT DISTINCT t.wallet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step3 s ON t.wallet = s.wallet
      WHERE t.entry_time >= now() - INTERVAL 5 DAY
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step4`);
    steps.push({ step: 'Buy trade last 5 days', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 5: Wallets with median bet > $10
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step5`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step5 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, quantile(0.5)(t.cost_usd) as median_bet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step4 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING median_bet > 10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step5`);
    steps.push({ step: 'Median bet > $10', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Create active days lookup table for Steps 6-7 and metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v21_step5)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet, toDate(entry_time)
    `);

    // Create last 14 active days lookup
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date
      FROM tmp_copytrade_v21_active_dates
      WHERE date_rank <= 14
    `);

    // Create last 7 active days lookup
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date
      FROM tmp_copytrade_v21_active_dates
      WHERE date_rank <= 7
    `);

    // Step 6: Wallets with log growth (all active days) > 0
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step6`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step6 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet as wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step5 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING log_growth > 0
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step6`);
    steps.push({ step: 'Log growth (all active) > 0', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 7: Wallets with log growth (last 14 active days) > 0
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step7`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_step7 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet as wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v21_step6 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
      HAVING log_growth_14d > 0
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_step7`);
    steps.push({ step: 'Log growth (14 active) > 0', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // ========== CALCULATE ALL METRICS FOR FINAL WALLETS ==========

    // Rebuild active days lookups for final wallets only
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v21_step7)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet, toDate(entry_time)
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v21_active_dates WHERE date_rank <= 14
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v21_active_dates WHERE date_rank <= 7
    `);

    // Lifetime percentiles (for winsorized metrics in output)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_percentiles_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        wallet,
        quantile(0.025)(pnl_usd / cost_usd) as p2_5,
        quantile(0.975)(pnl_usd / cost_usd) as p97_5
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v21_step7)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
      GROUP BY wallet
    `);

    // Lifetime metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades,
        countIf(t.pnl_usd > 0) as wins,
        countIf(t.pnl_usd <= 0) as losses,
        countIf(t.pnl_usd > 0) / count() as win_rate,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
        -- Winsorized EV
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev,
        -- Capital required based on ACTIVE days
        count() * avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) / nullIf(uniqExact(toDate(t.entry_time)) * 1440, 0) as capital_required,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
        dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
        uniqExact(toDate(t.entry_time)) as trading_days,
        count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
        sum(t.pnl_usd) as total_pnl,
        sum(t.cost_usd) as total_volume,
        countDistinct(t.condition_id) as markets_traded,
        min(t.entry_time) as first_trade,
        max(t.entry_time) as last_trade,
        -- Safe hold time
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_step7 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v21_percentiles_lifetime p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_lifetime`);
    steps.push({ step: 'Lifetime metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 14d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as p2_5,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as p97_5
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (SELECT wallet FROM tmp_copytrade_v21_step7)
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);

    // 14-day metrics (based on last 14 active days)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_14d,
        countIf(t.pnl_usd > 0) as wins_14d,
        countIf(t.pnl_usd <= 0) as losses_14d,
        countIf(t.pnl_usd > 0) / count() as win_rate_14d,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
        -- Winsorized EV 14d
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev_14d,
        -- Capital required 14d based on 14 active days
        count() * avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) / (14 * 1440) as capital_required_14d,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
        uniqExact(toDate(t.entry_time)) as trading_days_14d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
        sum(t.pnl_usd) as total_pnl_14d,
        sum(t.cost_usd) as total_volume_14d,
        countDistinct(t.condition_id) as markets_traded_14d,
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v21_step7 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v21_percentiles_14d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_14d`);
    steps.push({ step: '14-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 7d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_percentiles_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as p2_5,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as p97_5
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE t.wallet IN (SELECT wallet FROM tmp_copytrade_v21_step7)
        AND (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);

    // 7-day metrics (based on last 7 active days)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v21_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_7d,
        countIf(t.pnl_usd > 0) as wins_7d,
        countIf(t.pnl_usd <= 0) as losses_7d,
        countIf(t.pnl_usd > 0) / count() as win_rate_7d,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
        -- Winsorized EV 7d
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.p2_5), p.p97_5), t.pnl_usd <= 0)), 0) as winsorized_ev_7d,
        -- Capital required 7d based on 7 active days
        count() * avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) / (7 * 1440) as capital_required_7d,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
        uniqExact(toDate(t.entry_time)) as trading_days_7d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
        sum(t.pnl_usd) as total_pnl_7d,
        sum(t.cost_usd) as total_volume_7d,
        countDistinct(t.condition_id) as markets_traded_7d,
        avg(
          CASE
            WHEN t.resolved_at < '1971-01-01' THEN NULL
            WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
            WHEN t.resolved_at < t.entry_time THEN NULL
            ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
          END
        ) as avg_hold_time_minutes_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v21_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v21_step7 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v21_percentiles_7d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v21_7d`);
    steps.push({ step: '7-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Final table: Join into leaderboard
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_new`);
    await execute(`
      CREATE TABLE pm_copy_trading_leaderboard_v21_new ENGINE = ReplacingMergeTree() ORDER BY wallet AS
      SELECT
        l.wallet,
        -- RANKING METRIC: Daily Log Growth based on ACTIVE days
        -- (log_growth_per_trade × trades_per_active_day)
        l.log_growth_per_trade * l.trades_per_active_day as daily_log_growth,
        r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d as daily_log_growth_14d,
        r7.log_growth_per_trade_7d * r7.trades_per_active_day_7d as daily_log_growth_7d,
        -- Winsorized ROC (for reference, not filtered)
        round(l.winsorized_ev * l.total_trades / nullIf(l.capital_required, 0), 2) as winsorized_roc,
        round(r14.winsorized_ev_14d * r14.total_trades_14d / nullIf(r14.capital_required_14d, 0), 2) as winsorized_roc_14d,
        round(r7.winsorized_ev_7d * r7.total_trades_7d / nullIf(r7.capital_required_7d, 0), 2) as winsorized_roc_7d,
        -- Lifetime
        l.total_trades,
        l.wins,
        l.losses,
        l.win_rate,
        l.ev,
        l.winsorized_ev,
        l.log_growth_per_trade,
        l.calendar_days,
        l.trading_days,
        l.trades_per_day,
        l.trades_per_active_day,
        l.total_pnl,
        l.total_volume,
        l.markets_traded,
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
        coalesce(r14.log_growth_per_trade_14d, 0) as log_growth_per_trade_14d,
        coalesce(r14.trading_days_14d, 0) as trading_days_14d,
        coalesce(r14.trades_per_active_day_14d, 0) as trades_per_active_day_14d,
        coalesce(r14.total_pnl_14d, 0) as total_pnl_14d,
        coalesce(r14.total_volume_14d, 0) as total_volume_14d,
        coalesce(r14.markets_traded_14d, 0) as markets_traded_14d,
        r14.avg_hold_time_minutes_14d,
        -- 7d
        coalesce(r7.total_trades_7d, 0) as total_trades_7d,
        coalesce(r7.wins_7d, 0) as wins_7d,
        coalesce(r7.losses_7d, 0) as losses_7d,
        coalesce(r7.win_rate_7d, 0) as win_rate_7d,
        coalesce(r7.ev_7d, 0) as ev_7d,
        coalesce(r7.winsorized_ev_7d, 0) as winsorized_ev_7d,
        coalesce(r7.log_growth_per_trade_7d, 0) as log_growth_per_trade_7d,
        coalesce(r7.trading_days_7d, 0) as trading_days_7d,
        coalesce(r7.trades_per_active_day_7d, 0) as trades_per_active_day_7d,
        coalesce(r7.total_pnl_7d, 0) as total_pnl_7d,
        coalesce(r7.total_volume_7d, 0) as total_volume_7d,
        coalesce(r7.markets_traded_7d, 0) as markets_traded_7d,
        r7.avg_hold_time_minutes_7d,
        now() as refreshed_at
      FROM tmp_copytrade_v21_lifetime l
      INNER JOIN tmp_copytrade_v21_14d r14 ON l.wallet = r14.wallet
      INNER JOIN tmp_copytrade_v21_7d r7 ON l.wallet = r7.wallet
    `);

    // Atomic swap
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_old`);
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v21 TO pm_copy_trading_leaderboard_v21_old`).catch(() => {});
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v21_new TO pm_copy_trading_leaderboard_v21`);
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v21_old`);

    count = await queryCount(`SELECT count() as c FROM pm_copy_trading_leaderboard_v21`);
    steps.push({ step: 'Final leaderboard', count, durationMs: Date.now() - stepStart });

    // Cleanup temp tables
    for (let i = 1; i <= 7; i++) {
      await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_step${i}`);
    }
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_active_dates`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_14_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_last_7_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_percentiles_7d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v21_7d`);

    const totalDuration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      version: '21.8',
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
