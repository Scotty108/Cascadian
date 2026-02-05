import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

/**
 * Copy Trading Leaderboard v26 - ELITE TRADERS
 *
 * Strict filters to identify the "best of the best" traders.
 * Yields ~30-50 elite wallets vs thousands in v25.
 *
 * Schedule: Every 2 hours
 *
 * KEY CHANGES FROM v25:
 * 1. Added trades >= 50 filter (minimum sample size)
 * 2. Added win rate >= 55% filter
 * 3. Added profit factor >= 1.5 filter
 * 4. Changed recency to 7 days (was 5 days)
 *
 * Filters (8 steps):
 * 1. Markets > 10 (unique markets traded)
 * 2. Trades >= 50 (NEW - minimum sample size)
 * 3. Median bet > $10
 * 4. Win rate >= 55% (NEW)
 * 5. Profit factor >= 1.5 (NEW)
 * 6. Trade in last 7 calendar days (CHANGED from 5)
 * 7. CW winsorized log growth (all time) > 10%
 * 8. CW winsorized log growth (14 active days) > 10%
 *
 * Ranking: cw_winsorized_daily_log_growth_14d DESC
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

  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const steps: { step: string; count: number; durationMs: number }[] = [];
    let stepStart = Date.now();

    // Step 1: Markets > 10 AND Trades >= 50 (combined for efficiency)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step1`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step1 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        wallet,
        count(*) as total_trades,
        countDistinct(condition_id) as markets_traded
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND is_short = 0  -- EXCLUDE SHORTS (CLOB-only artifacts)
      GROUP BY wallet
      HAVING markets_traded > 10 AND total_trades >= 50
    `);
    let count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step1`);
    steps.push({ step: 'Markets > 10, Trades >= 50', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 2: Median bet > $10
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step2`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step2 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT t.wallet, quantile(0.5)(t.cost_usd) as median_bet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_step1 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
      HAVING median_bet > 10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step2`);
    steps.push({ step: 'Median bet > $10', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 3: Win rate >= 55% AND Profit factor >= 1.5
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step3`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step3 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        countIf(t.pnl_usd > 0) * 1.0 / count(*) as win_rate,
        sumIf(t.pnl_usd, t.pnl_usd > 0) / (abs(sumIf(t.pnl_usd, t.pnl_usd < 0)) + 0.01) as profit_factor
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_step2 s ON t.wallet = s.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
      HAVING win_rate >= 0.55 AND profit_factor >= 1.5
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step3`);
    steps.push({ step: 'Win rate >= 55%, Profit factor >= 1.5', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 4: Trade in last 7 days
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step4`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step4 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT DISTINCT t.wallet
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_step3 s ON t.wallet = s.wallet
      WHERE t.entry_time >= now() - INTERVAL 7 DAY
        AND t.is_short = 0
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step4`);
    steps.push({ step: 'Trade last 7 days', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Calculate percentiles for winsorization
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_percentiles ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        wallet,
        quantile(0.025)(pnl_usd / cost_usd) as roi_floor,
        quantile(0.975)(pnl_usd / cost_usd) as roi_ceiling
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v26_step4)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND is_short = 0
      GROUP BY wallet
    `);

    // Step 5: CW winsorized log growth (all time) > 10%
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step5`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step5 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        sum(t.cost_usd * log1p(greatest(
          least(t.pnl_usd / t.cost_usd, p.roi_ceiling),
          greatest(p.roi_floor, -0.99)
        ))) / sum(t.cost_usd) as cw_winsorized_log_growth
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_step4 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v26_percentiles p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
      HAVING cw_winsorized_log_growth > 0.10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step5`);
    steps.push({ step: 'CW log growth (all time) > 10%', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Create active days lookup for 14d filter
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v26_step5)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND is_short = 0
      GROUP BY wallet, toDate(entry_time)
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v26_active_dates WHERE date_rank <= 14
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v26_active_dates WHERE date_rank <= 7
    `);

    // 14d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_14d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);

    // Step 6: CW winsorized log growth (14d) > 10%
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step6`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_step6 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        sum(t.cost_usd * log1p(greatest(
          least(t.pnl_usd / t.cost_usd, p.roi_ceiling_14d),
          greatest(p.roi_floor_14d, -0.99)
        ))) / sum(t.cost_usd) as cw_winsorized_log_growth_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v26_step5 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v26_percentiles_14d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
      HAVING cw_winsorized_log_growth_14d > 0.10
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_step6`);
    steps.push({ step: 'CW log growth (14d) > 10%', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // ========== CALCULATE ALL METRICS FOR FINAL ELITE WALLETS ==========

    // Rebuild active days for final wallets
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_active_dates`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT
        wallet,
        toDate(entry_time) as trade_date,
        row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v26_step6)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND is_short = 0
      GROUP BY wallet, toDate(entry_time)
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_14_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v26_active_dates WHERE date_rank <= 14
    `);

    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_7_active_days`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
      SELECT wallet, trade_date FROM tmp_copytrade_v26_active_dates WHERE date_rank <= 7
    `);

    // Lifetime percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_percentiles_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        wallet,
        quantile(0.025)(pnl_usd / cost_usd) as roi_floor,
        quantile(0.975)(pnl_usd / cost_usd) as roi_ceiling
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_v26_step6)
        AND (resolved_at IS NOT NULL OR is_closed = 1)
        AND cost_usd > 0
        AND is_short = 0
      GROUP BY wallet
    `);

    // Lifetime metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_lifetime`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_lifetime ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades,
        countIf(t.pnl_usd > 0) as wins,
        countIf(t.pnl_usd <= 0) as losses,
        countIf(t.pnl_usd > 0) / count() as win_rate,
        sumIf(t.pnl_usd, t.pnl_usd > 0) / (abs(sumIf(t.pnl_usd, t.pnl_usd < 0)) + 0.01) as profit_factor,
        -- Standard EV
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev,
        -- Winsorized EV
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor), p.roi_ceiling), t.pnl_usd <= 0)), 0) as winsorized_ev,
        any(p.roi_floor) as roi_floor,
        any(p.roi_ceiling) as roi_ceiling,
        -- Log growth
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
        -- CW winsorized log growth
        sum(t.cost_usd * log1p(greatest(
          least(t.pnl_usd / t.cost_usd, p.roi_ceiling),
          greatest(p.roi_floor, -0.99)
        ))) / sum(t.cost_usd) as cw_winsorized_log_growth,
        -- Days
        dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1 as calendar_days,
        uniqExact(toDate(t.entry_time)) as trading_days,
        count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day,
        -- PnL
        sum(t.pnl_usd) as total_pnl,
        sum(t.cost_usd) as total_volume,
        countDistinct(t.condition_id) as markets_traded,
        avg(t.cost_usd) as avg_bet_size,
        quantile(0.5)(t.cost_usd) as median_bet_size,
        min(t.entry_time) as first_trade,
        max(t.entry_time) as last_trade,
        avg(CASE
          WHEN t.resolved_at < '1971-01-01' THEN NULL
          WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
          WHEN t.resolved_at < t.entry_time THEN NULL
          ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
        END) as avg_hold_time_minutes
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_step6 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v26_percentiles_lifetime p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_lifetime`);
    steps.push({ step: 'Lifetime metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 14d percentiles (refresh)
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_percentiles_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_14d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);

    // 14d metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_14d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_14d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_14d,
        countIf(t.pnl_usd > 0) as wins_14d,
        countIf(t.pnl_usd <= 0) as losses_14d,
        countIf(t.pnl_usd > 0) / count() as win_rate_14d,
        sumIf(t.pnl_usd, t.pnl_usd > 0) / (abs(sumIf(t.pnl_usd, t.pnl_usd < 0)) + 0.01) as profit_factor_14d,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_14d,
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_14d), p.roi_ceiling_14d), t.pnl_usd <= 0)), 0) as winsorized_ev_14d,
        any(p.roi_floor_14d) as roi_floor_14d,
        any(p.roi_ceiling_14d) as roi_ceiling_14d,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_14d,
        sum(t.cost_usd * log1p(greatest(
          least(t.pnl_usd / t.cost_usd, p.roi_ceiling_14d),
          greatest(p.roi_floor_14d, -0.99)
        ))) / sum(t.cost_usd) as cw_winsorized_log_growth_14d,
        uniqExact(toDate(t.entry_time)) as trading_days_14d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_14d,
        sum(t.pnl_usd) as total_pnl_14d,
        sum(t.cost_usd) as total_volume_14d,
        countDistinct(t.condition_id) as markets_traded_14d,
        avg(t.cost_usd) as avg_bet_size_14d,
        avg(CASE
          WHEN t.resolved_at < '1971-01-01' THEN NULL
          WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
          WHEN t.resolved_at < t.entry_time THEN NULL
          ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
        END) as avg_hold_time_minutes_14d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v26_step6 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v26_percentiles_14d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_14d`);
    steps.push({ step: '14-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // 7d percentiles
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_percentiles_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        quantile(0.025)(t.pnl_usd / t.cost_usd) as roi_floor_7d,
        quantile(0.975)(t.pnl_usd / t.cost_usd) as roi_ceiling_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);

    // 7d metrics
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_7d`);
    await execute(`
      CREATE TABLE tmp_copytrade_v26_7d ENGINE = MergeTree() ORDER BY wallet AS
      SELECT
        t.wallet as wallet,
        count() as total_trades_7d,
        countIf(t.pnl_usd > 0) as wins_7d,
        countIf(t.pnl_usd <= 0) as losses_7d,
        countIf(t.pnl_usd > 0) / count() as win_rate_7d,
        sumIf(t.pnl_usd, t.pnl_usd > 0) / (abs(sumIf(t.pnl_usd, t.pnl_usd < 0)) + 0.01) as profit_factor_7d,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)), 0)) as ev_7d,
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * ifNull(abs(quantileIf(0.5)(least(greatest(t.pnl_usd / t.cost_usd, p.roi_floor_7d), p.roi_ceiling_7d), t.pnl_usd <= 0)), 0) as winsorized_ev_7d,
        any(p.roi_floor_7d) as roi_floor_7d,
        any(p.roi_ceiling_7d) as roi_ceiling_7d,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade_7d,
        sum(t.cost_usd * log1p(greatest(
          least(t.pnl_usd / t.cost_usd, p.roi_ceiling_7d),
          greatest(p.roi_floor_7d, -0.99)
        ))) / sum(t.cost_usd) as cw_winsorized_log_growth_7d,
        uniqExact(toDate(t.entry_time)) as trading_days_7d,
        count() / uniqExact(toDate(t.entry_time)) as trades_per_active_day_7d,
        sum(t.pnl_usd) as total_pnl_7d,
        sum(t.cost_usd) as total_volume_7d,
        countDistinct(t.condition_id) as markets_traded_7d,
        avg(CASE
          WHEN t.resolved_at < '1971-01-01' THEN NULL
          WHEN t.resolved_at < t.entry_time AND dateDiff('minute', t.resolved_at, t.entry_time) <= 5 THEN 1
          WHEN t.resolved_at < t.entry_time THEN NULL
          ELSE greatest(dateDiff('minute', t.entry_time, t.resolved_at), 1)
        END) as avg_hold_time_minutes_7d
      FROM pm_trade_fifo_roi_v3_mat_unified t
      INNER JOIN tmp_copytrade_v26_last_7_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
      INNER JOIN tmp_copytrade_v26_step6 s ON t.wallet = s.wallet
      INNER JOIN tmp_copytrade_v26_percentiles_7d p ON t.wallet = p.wallet
      WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
        AND t.cost_usd > 0
        AND t.is_short = 0
      GROUP BY t.wallet
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_v26_7d`);
    steps.push({ step: '7-day metrics', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Final leaderboard table
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v26_new`);
    await execute(`
      CREATE TABLE pm_copy_trading_leaderboard_v26_new ENGINE = ReplacingMergeTree() ORDER BY wallet AS
      SELECT
        l.wallet,
        -- RANKING METRICS
        l.cw_winsorized_log_growth * l.trades_per_active_day as cw_winsorized_daily_log_growth,
        r14.cw_winsorized_log_growth_14d * r14.trades_per_active_day_14d as cw_winsorized_daily_log_growth_14d,
        r7.cw_winsorized_log_growth_7d * r7.trades_per_active_day_7d as cw_winsorized_daily_log_growth_7d,
        -- Legacy
        l.log_growth_per_trade * l.trades_per_active_day as daily_log_growth,
        r14.log_growth_per_trade_14d * r14.trades_per_active_day_14d as daily_log_growth_14d,
        r7.log_growth_per_trade_7d * r7.trades_per_active_day_7d as daily_log_growth_7d,
        -- Lifetime
        l.total_trades,
        l.wins,
        l.losses,
        l.win_rate,
        l.profit_factor,
        l.ev,
        l.winsorized_ev,
        l.roi_floor,
        l.roi_ceiling,
        l.log_growth_per_trade,
        l.cw_winsorized_log_growth,
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
        coalesce(r14.profit_factor_14d, 0) as profit_factor_14d,
        coalesce(r14.ev_14d, 0) as ev_14d,
        coalesce(r14.winsorized_ev_14d, 0) as winsorized_ev_14d,
        r14.roi_floor_14d,
        r14.roi_ceiling_14d,
        coalesce(r14.log_growth_per_trade_14d, 0) as log_growth_per_trade_14d,
        coalesce(r14.cw_winsorized_log_growth_14d, 0) as cw_winsorized_log_growth_14d,
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
        coalesce(r7.profit_factor_7d, 0) as profit_factor_7d,
        coalesce(r7.ev_7d, 0) as ev_7d,
        coalesce(r7.winsorized_ev_7d, 0) as winsorized_ev_7d,
        r7.roi_floor_7d,
        r7.roi_ceiling_7d,
        coalesce(r7.log_growth_per_trade_7d, 0) as log_growth_per_trade_7d,
        coalesce(r7.cw_winsorized_log_growth_7d, 0) as cw_winsorized_log_growth_7d,
        coalesce(r7.trading_days_7d, 0) as trading_days_7d,
        coalesce(r7.trades_per_active_day_7d, 0) as trades_per_active_day_7d,
        coalesce(r7.total_pnl_7d, 0) as total_pnl_7d,
        coalesce(r7.total_volume_7d, 0) as total_volume_7d,
        coalesce(r7.markets_traded_7d, 0) as markets_traded_7d,
        r7.avg_hold_time_minutes_7d,
        now() as refreshed_at
      FROM tmp_copytrade_v26_lifetime l
      INNER JOIN tmp_copytrade_v26_14d r14 ON l.wallet = r14.wallet
      INNER JOIN tmp_copytrade_v26_7d r7 ON l.wallet = r7.wallet
    `);

    // Atomic swap
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v26_old`);
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v26 TO pm_copy_trading_leaderboard_v26_old`).catch(() => {});
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v26_new TO pm_copy_trading_leaderboard_v26`);
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v26_old`);

    count = await queryCount(`SELECT count() as c FROM pm_copy_trading_leaderboard_v26`);
    steps.push({ step: 'Final elite leaderboard', count, durationMs: Date.now() - stepStart });

    // Cleanup
    for (let i = 1; i <= 6; i++) {
      await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_step${i}`);
    }
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_active_dates`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_14_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_last_7_active_days`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_lifetime`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_14d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_percentiles_7d`);
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_v26_7d`);

    const totalDuration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      version: '26-elite',
      wallets: count,
      steps,
      totalDurationMs: totalDuration,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Elite leaderboard refresh failed:', error);
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
