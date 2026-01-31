import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

/**
 * Copy Trading Leaderboard v20 - Cron Refresh
 *
 * Refreshes the copy trading leaderboard with validated metrics.
 * Schedule: Daily at 6am UTC
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
  const rows = await result.json<{ c: number }[]>();
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

    // Step 1: Wallets active in last 5 days
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_step1`);
    await execute(`
      CREATE TABLE tmp_copytrade_step1 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL 5 DAY
    `);
    let count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step1`);
    steps.push({ step: 'Active last 5 days', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 2: Wallets ≥ 8 days old
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_step2`);
    await execute(`
      CREATE TABLE tmp_copytrade_step2 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT wallet, min(entry_time) as first_trade
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_step1)
      GROUP BY wallet
      HAVING first_trade <= now() - INTERVAL 8 DAY
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step2`);
    steps.push({ step: 'Age ≥ 8 days', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 3: Wallets with ≥ 8 markets
    await execute(`DROP TABLE IF EXISTS tmp_copytrade_step3`);
    await execute(`
      CREATE TABLE tmp_copytrade_step3 ENGINE = MergeTree() ORDER BY wallet AS
      SELECT wallet, countDistinct(condition_id) as markets_traded
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN (SELECT wallet FROM tmp_copytrade_step2)
      GROUP BY wallet
      HAVING markets_traded >= 8
    `);
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step3`);
    steps.push({ step: '≥ 8 markets', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 4: Wallets with > 50 trades
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
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step4`);
    steps.push({ step: '> 50 trades', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 5: Wallets with median bet ≥ $10
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
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step5`);
    steps.push({ step: 'Median bet ≥ $10', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 6: Wallets with median ROI ≥ 5%
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
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step6`);
    steps.push({ step: 'Median ROI ≥ 5%', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 7: Wallets with EV > 0
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
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step7`);
    steps.push({ step: 'EV > 0', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 8: Wallets with Total PnL ≥ 0
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
    count = await queryCount(`SELECT count() as c FROM tmp_copytrade_step8`);
    steps.push({ step: 'Total PnL ≥ 0', count, durationMs: Date.now() - stepStart });
    stepStart = Date.now();

    // Step 9: Calculate final metrics
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v20_new`);
    await execute(`
      CREATE TABLE pm_copy_trading_leaderboard_v20_new ENGINE = ReplacingMergeTree() ORDER BY wallet AS
      SELECT
        t.wallet,
        count() as total_trades,
        countIf(t.pnl_usd > 0) as wins,
        countIf(t.pnl_usd <= 0) as losses,
        countIf(t.pnl_usd > 0) / count() as win_rate,
        (countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)) as ev,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_per_trade,
        count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as trades_per_day,
        avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99)))
          * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
          * 100 as log_return_pct_per_day,
        ((countIf(t.pnl_usd > 0) / count()) * quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd > 0)
        - (1 - countIf(t.pnl_usd > 0) / count()) * abs(quantileIf(0.5)(t.pnl_usd / t.cost_usd, t.pnl_usd <= 0)))
          * (count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1))
          * 100 as ev_per_day,
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

    // Atomic swap
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v20_old`);
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v20 TO pm_copy_trading_leaderboard_v20_old`).catch(() => {});
    await execute(`RENAME TABLE pm_copy_trading_leaderboard_v20_new TO pm_copy_trading_leaderboard_v20`);
    await execute(`DROP TABLE IF EXISTS pm_copy_trading_leaderboard_v20_old`);

    count = await queryCount(`SELECT count() as c FROM pm_copy_trading_leaderboard_v20`);
    steps.push({ step: 'Final leaderboard', count, durationMs: Date.now() - stepStart });

    // Cleanup temp tables
    for (let i = 1; i <= 8; i++) {
      await execute(`DROP TABLE IF EXISTS tmp_copytrade_step${i}`);
    }

    const totalDuration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
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
