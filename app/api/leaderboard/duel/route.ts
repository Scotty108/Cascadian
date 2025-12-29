/**
 * DUEL Leaderboard API
 *
 * GET /api/leaderboard/duel
 *
 * Returns ranked wallets from precomputed DUEL metrics.
 * Only includes wallets where is_rankable = true.
 *
 * Query parameters:
 * - limit: number of results (default 50, max 500)
 * - offset: pagination offset (default 0)
 * - sort: realized_economic (default) | realized_cash | total_volume | total_economic
 * - order: desc (default) | asc
 * - tier: A | B | AB (default AB - both tiers)
 *
 * Response includes:
 * - Ranked wallets with full metrics
 * - Pagination info
 * - Data freshness info
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Use the view (argMax with tie-breaker) - single source of truth for latest-by-wallet
const VIEW_NAME = 'wallet_duel_metrics_latest_v2';
// Fallback to old table if view doesn't exist yet
const FALLBACK_TABLE = 'wallet_duel_metrics_latest';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// Note: net_cashflow_30d removed from sort (it's NOT PnL - accumulating wallets will be negative)
type SortField = 'realized_economic' | 'realized_cash' | 'total_volume' | 'total_economic' | 'market_win_rate' | 'volume_30d' | 'omega_180d';
type SortOrder = 'asc' | 'desc';
type TierFilter = 'A' | 'B' | 'AB';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  realized_economic: number;
  realized_cash: number;
  unrealized: number;
  total_economic: number;
  total_cash: number;
  positions_count: number;
  markets_traded: number;
  total_volume: number;
  // Win rate (market-level)
  markets_won: number;
  markets_lost: number;
  market_win_rate: number;
  // Recency metrics (mapped trades only)
  net_cashflow_30d: number; // sell - buy (NOT PnL)
  volume_30d: number;
  trades_30d: number;
  last_trade_ts: string | null;
  // Omega metrics (180-day trailing)
  omega_180d: number;
  decided_markets_180d: number;
  wins_180d: number;
  losses_180d: number;
  // Data quality
  rankability_tier: string;
  usdc_coverage_pct: number;
  trade_coverage_pct: number;
  computed_at: string;
}

interface LeaderboardResponse {
  success: true;
  data: {
    entries: LeaderboardEntry[];
    pagination: {
      limit: number;
      offset: number;
      total: number;
      hasMore: boolean;
    };
    meta: {
      sort: SortField;
      order: SortOrder;
      tier_filter: TierFilter;
      oldest_entry: string | null;
      newest_entry: string | null;
    };
  };
}

interface LeaderboardError {
  success: false;
  error: string;
}

function validateSortField(field: string | null): SortField {
  const valid: SortField[] = ['realized_economic', 'realized_cash', 'total_volume', 'total_economic', 'market_win_rate', 'volume_30d', 'omega_180d'];
  return valid.includes(field as SortField) ? (field as SortField) : 'realized_economic';
}

function validateOrder(order: string | null): SortOrder {
  return order === 'asc' ? 'asc' : 'desc';
}

function validateTier(tier: string | null): TierFilter {
  if (tier === 'A' || tier === 'B') return tier;
  return 'AB';
}

export async function GET(request: NextRequest): Promise<NextResponse<LeaderboardResponse | LeaderboardError>> {
  try {
    const url = new URL(request.url);

    // Parse query parameters
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const sortParam = url.searchParams.get('sort');
    const orderParam = url.searchParams.get('order');
    const tierParam = url.searchParams.get('tier');

    const limit = Math.min(Math.max(1, parseInt(limitParam || '', 10) || DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, parseInt(offsetParam || '', 10) || 0);
    const sort = validateSortField(sortParam);
    const order = validateOrder(orderParam);
    const tier = validateTier(tierParam);

    // Check if view exists, fall back to old table
    const viewCheckQuery = `SELECT count() as cnt FROM system.tables WHERE name = '${VIEW_NAME}'`;
    const viewCheckResult = await clickhouse.query({ query: viewCheckQuery, format: 'JSONEachRow' });
    const viewExists = ((await viewCheckResult.json()) as any[])[0]?.cnt > 0;
    const tableName = viewExists ? VIEW_NAME : FALLBACK_TABLE;

    // Build tier filter clause
    let tierClause = '';
    if (tier === 'A') {
      tierClause = "AND rankability_tier = 'A'";
    } else if (tier === 'B') {
      tierClause = "AND rankability_tier = 'B'";
    } else {
      tierClause = "AND rankability_tier IN ('A', 'B')";
    }

    // Count query - view already guarantees 1 row per wallet via argMax
    const countQuery = `
      SELECT count() as total
      FROM ${tableName}
      WHERE is_rankable = 1
      ${tierClause}
    `;
    const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
    const totalCount = ((await countResult.json()) as any[])[0]?.total || 0;

    // Data query - NO re-argMax, NO row_number() (compute rank in API: offset + i + 1)
    // View guarantees 1 row per wallet with deterministic tie-breaker
    const dataQuery = `
      SELECT
        wallet_address,
        realized_economic,
        realized_cash,
        unrealized,
        total_economic,
        total_cash,
        positions_count,
        markets_traded,
        total_volume,
        markets_won,
        markets_lost,
        market_win_rate,
        net_cashflow_30d,
        volume_30d,
        trades_30d,
        last_trade_ts,
        omega_180d,
        decided_markets_180d,
        wins_180d,
        losses_180d,
        rankability_tier,
        usdc_coverage_pct,
        trade_coverage_pct,
        latest_computed_at as computed_at
      FROM ${tableName}
      WHERE is_rankable = 1
      ${tierClause}
      ORDER BY ${sort} ${order.toUpperCase()}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const dataResult = await clickhouse.query({ query: dataQuery, format: 'JSONEachRow' });
    const rows = (await dataResult.json()) as any[];

    // Map to response format - compute rank in API (offset + i + 1)
    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank: offset + i + 1, // Compute rank in API, not SQL
      wallet: row.wallet_address,
      realized_economic: roundTo(Number(row.realized_economic), 2),
      realized_cash: roundTo(Number(row.realized_cash), 2),
      unrealized: roundTo(Number(row.unrealized), 2),
      total_economic: roundTo(Number(row.total_economic), 2),
      total_cash: roundTo(Number(row.total_cash), 2),
      positions_count: Number(row.positions_count),
      markets_traded: Number(row.markets_traded),
      total_volume: roundTo(Number(row.total_volume), 2),
      markets_won: Number(row.markets_won),
      markets_lost: Number(row.markets_lost),
      market_win_rate: roundTo(Number(row.market_win_rate) * 100, 1), // Convert to percentage
      net_cashflow_30d: roundTo(Number(row.net_cashflow_30d), 2),
      volume_30d: roundTo(Number(row.volume_30d), 2),
      trades_30d: Number(row.trades_30d),
      last_trade_ts: row.last_trade_ts || null,
      omega_180d: roundTo(Number(row.omega_180d), 2),
      decided_markets_180d: Number(row.decided_markets_180d),
      wins_180d: Number(row.wins_180d),
      losses_180d: Number(row.losses_180d),
      rankability_tier: row.rankability_tier,
      usdc_coverage_pct: roundTo(Number(row.usdc_coverage_pct), 2),
      trade_coverage_pct: roundTo(Number(row.trade_coverage_pct), 2),
      computed_at: row.computed_at,
    }));

    // Get freshness info - view already has 1 row per wallet
    const freshnessQuery = `
      SELECT
        min(latest_computed_at) as oldest,
        max(latest_computed_at) as newest
      FROM ${tableName}
      WHERE is_rankable = 1
      ${tierClause}
    `;
    const freshnessResult = await clickhouse.query({ query: freshnessQuery, format: 'JSONEachRow' });
    const freshness = ((await freshnessResult.json()) as any[])[0] || {};

    const response: LeaderboardResponse = {
      success: true,
      data: {
        entries,
        pagination: {
          limit,
          offset,
          total: totalCount,
          hasMore: offset + entries.length < totalCount,
        },
        meta: {
          sort,
          order,
          tier_filter: tier,
          oldest_entry: freshness.oldest || null,
          newest_entry: freshness.newest || null,
        },
      },
    };

    return NextResponse.json(response, {
      headers: {
        // Cache for 5 minutes since data is precomputed
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
    });
  } catch (error: any) {
    console.error('[Leaderboard] Error:', error);

    // Check if table/view doesn't exist
    if (error.message?.includes('Table') && error.message?.includes("doesn't exist")) {
      return NextResponse.json(
        {
          success: false,
          error: `Leaderboard view/table not initialized. Run build-duel-metrics-history-table.ts first.`,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch leaderboard',
      },
      { status: 500 }
    );
  }
}

function roundTo(value: number, decimals: number): number {
  if (!isFinite(value)) return 0;
  return parseFloat(value.toFixed(decimals));
}
