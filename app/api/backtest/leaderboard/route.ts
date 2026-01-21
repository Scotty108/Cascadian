/**
 * API: Copy Trading Backtest Leaderboard
 *
 * Returns top wallets ranked by copy trading ROI across different time windows.
 *
 * Query params:
 * - page: Page number (default 1)
 * - pageSize: Items per page (default 20, max 100)
 * - window: Window type ('trade_10', 'trade_25', 'trade_50', 'trade_200', 'day_3', 'day_7', 'day_14', 'day_30')
 * - category: Filter by category ('ALL', 'Crypto', 'Sports', 'Politics', 'Other')
 * - minTrades: Minimum trades in window (default 5)
 * - minWinRate: Minimum win rate (0-1)
 * - sortBy: Sort field ('composite', 'roi', 'win_rate', 'trades', 'velocity')
 * - sortDir: Sort direction ('asc', 'desc')
 * - slippage: Include slippage ROI ('true', 'false') - default false
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface BacktestEntry {
  rank: number;
  wallet: string;
  category: string;
  window_type: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_roi_pct: number;
  total_roi_with_slippage: number;
  avg_roi_per_trade: number;
  avg_hours_to_exit: number;
  median_hours_to_exit: number;
  early_exits: number;
  held_to_resolution: number;
  composite_score: number;
  last_trade: string;
}

const SORT_FIELD_MAP: Record<string, string> = {
  composite: 'composite_score',
  roi: 'total_roi_pct',
  win_rate: 'win_rate',
  trades: 'total_trades',
  velocity: 'avg_hours_to_exit',
};

const VALID_WINDOWS = [
  'trade_10', 'trade_25', 'trade_50', 'trade_200',
  'day_3', 'day_7', 'day_14', 'day_30'
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get('pageSize') || 20)), 100);
    const window = searchParams.get('window') || 'trade_50';
    const category = searchParams.get('category');
    const minTrades = Number(searchParams.get('minTrades') || 5);
    const minWinRate = searchParams.get('minWinRate') ? Number(searchParams.get('minWinRate')) : null;
    const sortBy = searchParams.get('sortBy') || 'composite';
    const sortDir = searchParams.get('sortDir') || 'desc';
    const useSlippage = searchParams.get('slippage') === 'true';

    // Validate window
    if (!VALID_WINDOWS.includes(window)) {
      return NextResponse.json({
        success: false,
        error: `Invalid window. Must be one of: ${VALID_WINDOWS.join(', ')}`,
        leaderboard: [],
      }, { status: 400 });
    }

    const offset = (page - 1) * pageSize;
    const sortField = SORT_FIELD_MAP[sortBy] || 'composite_score';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    // For velocity, lower is better, so flip direction
    const actualDirection = sortField === 'avg_hours_to_exit'
      ? (sortDirection === 'DESC' ? 'ASC' : 'DESC')
      : sortDirection;

    // Build category filter
    const categoryFilter = category
      ? `AND category = '${category}'`
      : '';

    // Main leaderboard query
    const query = `
      SELECT
        wallet,
        category,
        window_type,
        total_trades,
        wins,
        losses,
        win_rate,
        total_roi_pct,
        total_roi_with_slippage,
        avg_roi_per_trade,
        avg_hours_to_exit,
        median_hours_to_exit,
        early_exits,
        held_to_resolution,
        composite_score,
        last_trade
      FROM pm_copy_backtest_v1
      WHERE window_type = '${window}'
        AND total_trades >= ${minTrades}
        ${minWinRate !== null ? `AND win_rate >= ${minWinRate}` : ''}
        ${categoryFilter}
      ORDER BY ${sortField} ${actualDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    // Count query
    const countQuery = `
      SELECT count() as total
      FROM pm_copy_backtest_v1
      WHERE window_type = '${window}'
        AND total_trades >= ${minTrades}
        ${minWinRate !== null ? `AND win_rate >= ${minWinRate}` : ''}
        ${categoryFilter}
    `;

    // Summary stats query
    const summaryQuery = `
      SELECT
        category,
        count() as wallet_count,
        round(avg(total_roi_pct), 2) as avg_roi,
        round(avg(win_rate), 4) as avg_win_rate,
        round(avg(composite_score), 2) as avg_composite
      FROM pm_copy_backtest_v1
      WHERE window_type = '${window}'
        AND total_trades >= ${minTrades}
      GROUP BY category
      ORDER BY avg_composite DESC
    `;

    // Run queries in parallel
    const [mainResult, countResult, summaryResult] = await Promise.all([
      clickhouse.query({ query, format: 'JSONEachRow' }),
      clickhouse.query({ query: countQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' }),
    ]);

    const [rawLeaderboard, countData, categoryStats] = await Promise.all([
      mainResult.json() as Promise<any[]>,
      countResult.json() as Promise<Array<{ total: number }>>,
      summaryResult.json() as Promise<any[]>,
    ]);

    const totalCount = countData[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Add rank and adjust ROI if using slippage
    const leaderboard: BacktestEntry[] = rawLeaderboard.map((entry, index) => ({
      rank: offset + index + 1,
      ...entry,
      // If using slippage, show slippage ROI as the main ROI
      total_roi_pct: useSlippage ? entry.total_roi_with_slippage : entry.total_roi_pct,
    }));

    return NextResponse.json({
      success: true,
      count: leaderboard.length,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
      filters: {
        window,
        category: category || 'ALL',
        minTrades,
        minWinRate,
        useSlippage,
        sortBy,
        sortDir,
      },
      category_stats: categoryStats,
      leaderboard,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[backtest/leaderboard] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      leaderboard: [],
    }, { status: 500 });
  }
}
