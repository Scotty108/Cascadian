import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

/**
 * GET /api/leaderboard/ultra-active
 *
 * Returns ultra-active traders (last 3 days) with high performance metrics
 * Query params:
 * - days: number of days to look back (default: 3)
 * - minWinRate: minimum win rate percentage (default: 70)
 * - minMedianROI: minimum median ROI percentage (default: 30)
 * - minTrades: minimum number of trades (default: 30)
 * - minProfit: minimum total profit in USD (default: 10000)
 * - limit: max results (default: 100)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const days = parseInt(searchParams.get('days') || '3');
  const minWinRate = parseInt(searchParams.get('minWinRate') || '70');
  const minMedianROI = parseInt(searchParams.get('minMedianROI') || '30');
  const minTrades = parseInt(searchParams.get('minTrades') || '30');
  const minProfit = parseInt(searchParams.get('minProfit') || '10000');
  const limit = parseInt(searchParams.get('limit') || '100');

  try {
    const tradersResult = await clickhouse.query({
      query: `
        WITH deduped_fifo AS (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            any(pnl_usd) as pnl_usd,
            any(cost_usd) as cost_usd,
            any(roi) as roi,
            any(is_short) as is_short,
            any(resolved_at) as resolved_at,
            any(entry_time) as entry_time
          FROM pm_trade_fifo_roi_v3_deduped FINAL
          WHERE abs(cost_usd) >= 10
          GROUP BY wallet, condition_id, outcome_index
        ),
        wallet_stats AS (
          SELECT
            wallet,
            count() as total_trades,
            countIf(pnl_usd > 0) as wins,
            countIf(pnl_usd <= 0) as losses,
            round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,

            -- Overall PnL metrics
            sum(pnl_usd) as total_pnl,
            sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
            sumIf(pnl_usd, pnl_usd < 0) as gross_losses,

            -- ROI metrics (MEDIAN is key!)
            round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
            round(median(roi) * 100, 1) as median_roi_pct,
            round(stddevPop(roi) * 100, 1) as roi_stddev,

            -- Position sizing
            round(avg(abs(cost_usd)), 0) as avg_position_size,
            round(sum(abs(cost_usd)), 0) as total_volume,

            -- Frequency metrics
            dateDiff('day', min(resolved_at), max(resolved_at)) as trading_days,
            round(count() / nullIf(dateDiff('day', min(resolved_at), max(resolved_at)), 0), 1) as trades_per_day,

            -- Hold time
            round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,
            round(median(dateDiff('hour', entry_time, resolved_at)), 1) as median_hold_hours,

            -- Consistency
            countIf(is_short = 1) as short_trades,
            round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

            -- Recency
            max(resolved_at) as last_trade,
            dateDiff('day', max(resolved_at), now()) as days_since_last,
            dateDiff('hour', max(resolved_at), now()) as hours_since_last
          FROM deduped_fifo
          GROUP BY wallet
          HAVING total_trades >= ${minTrades}
            AND total_pnl > ${minProfit}
            AND win_rate_pct >= ${minWinRate}
            AND median_roi_pct >= ${minMedianROI}
            AND days_since_last <= ${days}
        )
        SELECT
          wallet,
          total_trades,
          wins,
          losses,
          win_rate_pct,
          round(total_pnl, 2) as total_pnl,
          round(gross_wins, 2) as gross_wins,
          round(gross_losses, 2) as gross_losses,
          avg_roi_pct,
          median_roi_pct,
          roi_stddev,
          avg_position_size,
          total_volume,
          trading_days,
          trades_per_day,
          avg_hold_hours,
          median_hold_hours,
          short_pct,
          last_trade,
          days_since_last,
          hours_since_last
        FROM wallet_stats
        ORDER BY median_roi_pct DESC, win_rate_pct DESC
        LIMIT ${limit}
      `,
      format: 'JSONEachRow'
    });

    const traders = (await tradersResult.json()) as any[];

    // Calculate cohort stats
    const cohortStats = traders.length > 0 ? {
      totalWallets: traders.length,
      totalProfit: traders.reduce((sum, w) => sum + w.total_pnl, 0),
      avgProfit: traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length,
      avgWinRate: traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length,
      avgMedianROI: traders.reduce((sum, w) => sum + w.median_roi_pct, 0) / traders.length,
      avgTrades: traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length,
    } : null;

    return NextResponse.json({
      success: true,
      data: traders,
      cohortStats,
      filters: {
        days,
        minWinRate,
        minMedianROI,
        minTrades,
        minProfit,
        limit
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Error fetching ultra-active leaderboard:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch ultra-active leaderboard',
        message: error.message
      },
      { status: 500 }
    );
  }
}
