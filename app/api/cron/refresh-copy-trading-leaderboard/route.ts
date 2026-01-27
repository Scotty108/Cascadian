/**
 * Cron: Refresh Copy Trading Leaderboard
 *
 * Calculates robust copy trading wallets - ranked by simulated ROI
 * WITHOUT top 3 trades to filter out lottery winners.
 *
 * Schedule: Every 3 hours (cron: 0 star-slash-3 star star star)
 * Timeout: 5 minutes
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
import { writeFile } from 'fs/promises';
import { join } from 'path';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

interface RobustWallet {
  rank: number;
  wallet: string;
  sim_roi_without_top3: number;
  sim_roi_all: number;
  median_roi_pct: number;
  trades: number;
  win_rate_pct: number;
  pnl_30d: number;
  best_trade_pct: number;
  pct_from_other_trades: number;
  avg_position: number;
  short_pct: number;
  hours_ago: number;
}

async function getRobustWallets(client: any): Promise<RobustWallet[]> {
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
        short_trades,
        round(short_trades * 100.0 / trades, 1) as short_pct,
        last_trade,
        dateDiff('hour', last_trade, now()) as hours_ago
      FROM wallet_stats
      WHERE roi_without_top3 > 0
        AND wins * 100.0 / trades > 40
      ORDER BY sim_roi_without_top3 DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    sim_roi_without_top3: r.sim_roi_without_top3,
    sim_roi_all: r.sim_roi_all,
    median_roi_pct: r.median_roi_pct,
    trades: r.trades,
    win_rate_pct: r.win_rate_pct,
    pnl_30d: r.pnl_30d,
    best_trade_pct: r.best_trade_pct,
    pct_from_other_trades: r.pct_from_other_trades,
    avg_position: r.avg_position,
    short_pct: r.short_pct,
    hours_ago: r.hours_ago,
  }));
}

async function upsertLeaderboardCache(client: any, wallets: RobustWallet[]): Promise<void> {
  if (wallets.length === 0) return;

  // Create table if not exists
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_copy_trading_leaderboard (
        rank UInt8,
        wallet LowCardinality(String),
        sim_roi_without_top3 Float32,
        sim_roi_all Float32,
        median_roi_pct Float32,
        trades UInt32,
        win_rate_pct Float32,
        pnl_30d Float64,
        best_trade_pct Float32,
        pct_from_other_trades Float32,
        avg_position Float64,
        short_pct Float32,
        hours_ago UInt32,
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (rank)
    `,
  }).catch(() => {});

  // Clear and repopulate
  await client.command({
    query: `TRUNCATE TABLE pm_copy_trading_leaderboard`,
  }).catch(() => {});

  // Insert new data
  await client.insert({
    table: 'pm_copy_trading_leaderboard',
    values: wallets,
    format: 'JSONEachRow',
  });
}

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-copy-trading-leaderboard');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    // Get robust wallets
    const robustWallets = await getRobustWallets(client);

    // Cache to ClickHouse table
    await upsertLeaderboardCache(client, robustWallets);

    const duration = (Date.now() - startTime) / 1000;

    // Build response object
    const leaderboardData = {
      generated_at: new Date().toISOString(),
      version: 'v2',
      description: 'Robust asymmetric copy trading wallets - ranked by simulated ROI WITHOUT top 3 trades',
      methodology: {
        primary_metric: 'sim_roi_without_top3',
        simulation: '$1 equal-weight per trade',
        filters: {
          lookback_days: 30,
          active_within_days: 2,
          min_trades: 25,
          min_win_rate_pct: 40,
        },
      },
      leaderboard: robustWallets,
    };

    return NextResponse.json({
      success: true,
      walletsFound: robustWallets.length,
      topWallet: robustWallets[0]?.wallet || null,
      topSimRoi: robustWallets[0]?.sim_roi_without_top3 || 0,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
      data: leaderboardData,
    });
  } catch (error) {
    console.error('Copy trading leaderboard refresh failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
