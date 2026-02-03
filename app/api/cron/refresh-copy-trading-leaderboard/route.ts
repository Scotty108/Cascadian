/**
 * Cron: Refresh Copy Trading Leaderboard
 *
 * Calculates robust copy trading wallets using log growth metrics.
 * Filters: 10+ markets, active in last 5 days, avg bet >$10, 14+ active days.
 * Ranking: Daily Log Growth (winsorized ROI at 2.5%/97.5%).
 *
 * Schedule: Every 3 hours (cron: 0 star-slash-3 star star star)
 * Timeout: 5 minutes
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

interface LeaderboardWallet {
  rank: number;
  wallet: string;
  daily_log_growth: number;
  log_growth_per_trade: number;
  active_days: number;
  total_trades: number;
  unique_markets: number;
  avg_bet: number;
  total_pnl: number;
  win_rate_pct: number;
  days_since_buy: number;
}

async function getLeaderboardWallets(client: any): Promise<LeaderboardWallet[]> {
  // New leaderboard filters:
  // 1. 10+ unique markets
  // 2. Bought in last 5 days
  // 3. Average bet > $10
  // 4. Winsorization (2.5%/97.5% ROI caps)
  // 5. Log Growth/Trade (all time) > 0
  // 6. Log Growth/Trade (14 active days) > 0
  // 7. Rank by Daily Log Growth (14 active days)

  const result = await client.query({
    query: `
      WITH
      -- Get ROI percentiles for winsorization (2.5% and 97.5%)
      percentiles AS (
        SELECT
          quantile(0.025)(roi) as p2_5,
          quantile(0.975)(roi) as p97_5
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at IS NOT NULL
      ),
      -- Apply winsorization to all trades
      wallet_trades AS (
        SELECT
          u.wallet,
          u.condition_id,
          u.roi,
          u.cost_usd,
          u.entry_time,
          u.pnl_usd,
          -- Winsorized ROI: cap at 2.5th and 97.5th percentiles
          greatest(p.p2_5, least(p.p97_5, u.roi)) as roi_winsorized,
          toDate(u.entry_time) as trade_date
        FROM pm_trade_fifo_roi_v3_mat_unified u
        CROSS JOIN percentiles p
        WHERE u.resolved_at IS NOT NULL
          AND u.cost_usd > 0
          AND u.cost_usd < 10000000  -- Sanity filter: max $10M per trade
      ),
      -- Daily aggregates per wallet
      wallet_daily AS (
        SELECT
          wallet,
          trade_date,
          sum(log(1 + roi_winsorized)) as daily_log_growth,
          count() as daily_trades,
          sum(pnl_usd) as daily_pnl
        FROM wallet_trades
        GROUP BY wallet, trade_date
      ),
      -- Wallet-level stats from daily data
      wallet_stats AS (
        SELECT
          wallet,
          count() as active_days,
          sum(daily_trades) as total_trades,
          sum(daily_log_growth) as total_log_growth,
          sum(daily_log_growth) / count() as daily_log_growth_avg,
          sum(daily_pnl) as total_pnl,
          max(trade_date) as last_active_date
        FROM wallet_daily
        GROUP BY wallet
      ),
      -- Get unique markets and other filters from trades
      wallet_filters AS (
        SELECT
          wallet,
          count(DISTINCT condition_id) as unique_markets,
          avg(cost_usd) as avg_bet,
          max(entry_time) as last_buy,
          countIf(pnl_usd > 0) as wins,
          count() as trades
        FROM wallet_trades
        GROUP BY wallet
      )
      SELECT
        ws.wallet,
        ws.active_days,
        ws.total_trades,
        wf.unique_markets,
        round(wf.avg_bet, 2) as avg_bet,
        round(ws.total_pnl, 2) as total_pnl,
        round(wf.wins * 100.0 / wf.trades, 1) as win_rate_pct,
        round(ws.total_log_growth / ws.total_trades, 6) as log_growth_per_trade,
        round(ws.daily_log_growth_avg, 6) as daily_log_growth,
        dateDiff('day', wf.last_buy, now()) as days_since_buy
      FROM wallet_stats ws
      JOIN wallet_filters wf ON ws.wallet = wf.wallet
      WHERE wf.unique_markets >= 10                         -- 10+ unique markets
        AND dateDiff('day', wf.last_buy, now()) <= 5        -- Bought in last 5 days
        AND wf.avg_bet > 10                                 -- Average bet > $10
        AND wf.avg_bet < 1000000                            -- Sanity: avg bet < $1M
        AND ws.total_log_growth / ws.total_trades > 0       -- Log growth/trade (all time) > 0
        AND ws.active_days >= 14                            -- 14+ active trading days
        AND ws.daily_log_growth_avg > 0                     -- Log growth/day > 0
        AND ws.total_trades <= 50000                        -- Exclude extreme market makers
      ORDER BY ws.daily_log_growth_avg DESC                 -- Rank by daily log growth
      LIMIT 20
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 240 },
  });

  const rows = (await result.json()) as any[];
  return rows.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    daily_log_growth: r.daily_log_growth,
    log_growth_per_trade: r.log_growth_per_trade,
    active_days: r.active_days,
    total_trades: r.total_trades,
    unique_markets: r.unique_markets,
    avg_bet: r.avg_bet,
    total_pnl: r.total_pnl,
    win_rate_pct: r.win_rate_pct,
    days_since_buy: r.days_since_buy,
  }));
}

async function upsertLeaderboardCache(client: any, wallets: LeaderboardWallet[]): Promise<void> {
  if (wallets.length === 0) return;

  // Drop and recreate table with new schema (v3)
  await client.command({
    query: `DROP TABLE IF EXISTS pm_copy_trading_leaderboard_new`,
  }).catch(() => {});

  await client.command({
    query: `
      CREATE TABLE pm_copy_trading_leaderboard_new (
        rank UInt8,
        wallet LowCardinality(String),
        daily_log_growth Float64,
        log_growth_per_trade Float64,
        active_days UInt16,
        total_trades UInt32,
        unique_markets UInt16,
        avg_bet Float64,
        total_pnl Float64,
        win_rate_pct Float32,
        days_since_buy UInt8,
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (rank)
    `,
  });

  // Insert new data
  await client.insert({
    table: 'pm_copy_trading_leaderboard_new',
    values: wallets,
    format: 'JSONEachRow',
  });

  // Atomic swap
  await client.command({
    query: `DROP TABLE IF EXISTS pm_copy_trading_leaderboard`,
  }).catch(() => {});

  await client.command({
    query: `RENAME TABLE pm_copy_trading_leaderboard_new TO pm_copy_trading_leaderboard`,
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

    // Get leaderboard wallets with new filters
    const leaderboardWallets = await getLeaderboardWallets(client);

    // Cache to ClickHouse table
    await upsertLeaderboardCache(client, leaderboardWallets);

    const duration = (Date.now() - startTime) / 1000;

    // Build response object
    const leaderboardData = {
      generated_at: new Date().toISOString(),
      version: 'v3',
      description: 'Copy trading leaderboard - ranked by Daily Log Growth (winsorized)',
      methodology: {
        primary_metric: 'daily_log_growth',
        winsorization: '2.5% / 97.5% ROI caps',
        filters: {
          min_unique_markets: 10,
          bought_within_days: 5,
          min_avg_bet: 10,
          min_active_days: 14,
          log_growth_per_trade_positive: true,
          log_growth_per_day_positive: true,
        },
      },
      leaderboard: leaderboardWallets,
    };

    return NextResponse.json({
      success: true,
      walletsFound: leaderboardWallets.length,
      topWallet: leaderboardWallets[0]?.wallet || null,
      topDailyLogGrowth: leaderboardWallets[0]?.daily_log_growth || 0,
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
