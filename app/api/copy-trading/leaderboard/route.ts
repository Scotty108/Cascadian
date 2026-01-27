/**
 * API: Copy Trading Leaderboard
 *
 * Returns the current robust copy trading wallet leaderboard.
 * Data is refreshed every 3 hours by cron.
 *
 * GET /api/copy-trading/leaderboard
 *   - Returns top 20 robust wallets ranked by sim ROI without top 3 trades
 *
 * GET /api/copy-trading/leaderboard?wallet=0x...
 *   - Returns stats for a specific wallet
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');

  try {
    const client = getClickHouseClient();

    if (wallet) {
      // Get specific wallet stats
      const result = await client.query({
        query: `
          WITH deduped_fifo AS (
            SELECT
              wallet,
              condition_id,
              outcome_index,
              any(pnl_usd) as pnl_usd,
              any(cost_usd) as cost_usd,
              any(is_short) as is_short,
              any(resolved_at) as resolved_at
            FROM pm_trade_fifo_roi_v3_deduped FINAL
            WHERE resolved_at >= now() - INTERVAL 30 DAY
              AND abs(cost_usd) > 10
              AND wallet = {wallet:String}
            GROUP BY wallet, condition_id, outcome_index
          ),
          wallet_trades AS (
            SELECT
              wallet,
              pnl_usd / nullIf(abs(cost_usd), 1) as roi,
              pnl_usd,
              abs(cost_usd) as cost,
              is_short,
              resolved_at,
              row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
            FROM deduped_fifo
          )
          SELECT
            wallet,
            count() as trades,
            countIf(pnl_usd > 0) as wins,
            round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
            round(sum(roi) * 100.0 / count(), 1) as sim_roi_all,
            round(sumIf(roi, rank_desc > 3) * 100.0 / (count() - 3), 1) as sim_roi_without_top3,
            round(median(roi) * 100, 1) as median_roi_pct,
            round(sum(pnl_usd), 0) as pnl_30d,
            round(max(roi) * 100, 0) as best_trade_pct,
            round(sumIf(roi, rank_desc > 3) * 100.0 / nullIf(sum(roi), 0), 1) as pct_from_other_trades,
            round(avg(cost), 0) as avg_position,
            countIf(is_short = 1) as short_trades,
            round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,
            max(resolved_at) as last_trade,
            dateDiff('hour', max(resolved_at), now()) as hours_ago
          FROM wallet_trades
          GROUP BY wallet
          HAVING count() >= 4
        `,
        query_params: { wallet: wallet.toLowerCase() },
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as any[];

      if (rows.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'Wallet not found or insufficient trades',
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        wallet: rows[0],
      });
    }

    // Get cached leaderboard
    const result = await client.query({
      query: `
        SELECT *
        FROM pm_copy_trading_leaderboard
        FINAL
        ORDER BY rank
      `,
      format: 'JSONEachRow',
    });

    const leaderboard = (await result.json()) as any[];

    // If cache is empty, compute fresh
    if (leaderboard.length === 0) {
      const freshResult = await client.query({
        query: `
          WITH deduped_fifo AS (
            SELECT
              wallet,
              condition_id,
              outcome_index,
              any(pnl_usd) as pnl_usd,
              any(cost_usd) as cost_usd,
              any(is_short) as is_short,
              any(resolved_at) as resolved_at
            FROM pm_trade_fifo_roi_v3_deduped FINAL
            WHERE resolved_at >= now() - INTERVAL 30 DAY
              AND abs(cost_usd) > 10
            GROUP BY wallet, condition_id, outcome_index
          ),
          wallet_trades AS (
            SELECT
              wallet,
              pnl_usd / nullIf(abs(cost_usd), 1) as roi,
              pnl_usd,
              abs(cost_usd) as cost,
              is_short,
              resolved_at,
              row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
            FROM deduped_fifo
          ),
          wallet_stats AS (
            SELECT
              wallet,
              count() as trades,
              countIf(pnl_usd > 0) as wins,
              sum(roi) as total_roi,
              sumIf(roi, rank_desc > 3) as roi_without_top3,
              max(roi) * 100 as best_trade_roi_pct,
              median(roi) * 100 as median_roi_pct,
              sum(pnl_usd) as pnl_30d,
              avg(cost) as avg_position,
              countIf(is_short = 1) as short_trades,
              max(resolved_at) as last_trade
            FROM wallet_trades
            GROUP BY wallet
            HAVING trades >= 25
              AND trades - 3 > 0
              AND max(resolved_at) >= now() - INTERVAL 2 DAY
          )
          SELECT
            wallet,
            round(roi_without_top3 * 100.0 / (trades - 3), 1) as sim_roi_without_top3,
            round(total_roi * 100.0 / trades, 1) as sim_roi_all,
            round(median_roi_pct, 1) as median_roi_pct,
            trades,
            round(wins * 100.0 / trades, 1) as win_rate_pct,
            round(pnl_30d, 0) as pnl_30d,
            round(best_trade_roi_pct, 0) as best_trade_pct,
            round(roi_without_top3 * 100.0 / nullIf(total_roi, 0), 1) as pct_from_other_trades,
            round(avg_position, 0) as avg_position,
            round(short_trades * 100.0 / trades, 1) as short_pct,
            dateDiff('hour', last_trade, now()) as hours_ago
          FROM wallet_stats
          WHERE roi_without_top3 > 0
            AND wins * 100.0 / trades > 40
          ORDER BY sim_roi_without_top3 DESC
          LIMIT 20
        `,
        format: 'JSONEachRow',
      });

      const freshLeaderboard = (await freshResult.json()) as any[];

      return NextResponse.json({
        success: true,
        cached: false,
        generated_at: new Date().toISOString(),
        description: 'Robust copy trading wallets - ranked by sim ROI without top 3 trades',
        leaderboard: freshLeaderboard.map((w, i) => ({ rank: i + 1, ...w })),
      });
    }

    return NextResponse.json({
      success: true,
      cached: true,
      description: 'Robust copy trading wallets - ranked by sim ROI without top 3 trades',
      leaderboard,
    });
  } catch (error) {
    console.error('Copy trading leaderboard error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
