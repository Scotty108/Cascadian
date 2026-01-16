/**
 * API: Get Wallet Positions (Lazy Load)
 *
 * Returns open and closed positions for a wallet.
 * Called on-demand when user opens the Positions tab.
 *
 * Path: /api/wio/wallet/[address]/positions
 * Query params:
 * - page: Page number for closed positions (default 1)
 * - pageSize: Items per page (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface OpenPosition {
  market_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
  category: string;
  side: string;
  open_shares_net: number;
  open_cost_usd: number;
  avg_entry_price: number;
  mark_price: number;
  unrealized_pnl_usd: number;
  unrealized_roi: number;
  bundle_id: string;
  as_of_ts: string;
  image_url: string | null;
}

interface ClosedPosition {
  position_id: string;
  market_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
  category: string;
  side: string;
  shares: number;
  entry_price: number;
  exit_price: number;
  cost_usd: number;
  proceeds_usd: number;
  pnl_usd: number;
  roi: number;
  hold_minutes: number;
  brier_score: number | null;
  is_resolved: number;
  ts_open: string;
  ts_close: string | null;
  ts_resolve: string | null;
  image_url: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get('pageSize') || 50)), 100);
    const offset = (page - 1) * pageSize;

    // Run queries in parallel
    const [openResult, closedResult, closedCountResult] = await Promise.all([
      // Open positions from wio_positions_v2 (deduplicated automatically - one per condition+outcome)
      clickhouse.query({
        query: `
          SELECT
            pos.condition_id as market_id,
            pos.condition_id as condition_id,
            pos.outcome_index as outcome_index,
            COALESCE(any(m.question), '') as question,
            COALESCE(any(m.category), any(pos.category)) as category,
            CASE WHEN pos.outcome_index = 0 THEN 'NO' ELSE 'YES' END as side,
            sum(pos.qty_shares_remaining) as open_shares_net,
            sum(pos.cost_usd) as open_cost_usd,
            sum(pos.cost_usd) / sum(pos.qty_shares_remaining) as avg_entry_price,
            COALESCE(any(mp.mark_price), 0.5) as mark_price,
            CASE WHEN pos.outcome_index = 1
              THEN (COALESCE(any(mp.mark_price), 0.5) - sum(pos.cost_usd) / sum(pos.qty_shares_remaining)) * sum(pos.qty_shares_remaining)
              ELSE (sum(pos.cost_usd) / sum(pos.qty_shares_remaining) - COALESCE(any(mp.mark_price), 0.5)) * sum(pos.qty_shares_remaining)
            END as unrealized_pnl_usd,
            CASE WHEN sum(pos.cost_usd) > 0
              THEN CASE WHEN pos.outcome_index = 1
                THEN ((COALESCE(any(mp.mark_price), 0.5) - sum(pos.cost_usd) / sum(pos.qty_shares_remaining)) * sum(pos.qty_shares_remaining)) / sum(pos.cost_usd)
                ELSE ((sum(pos.cost_usd) / sum(pos.qty_shares_remaining) - COALESCE(any(mp.mark_price), 0.5)) * sum(pos.qty_shares_remaining)) / sum(pos.cost_usd)
              END
            ELSE 0 END as unrealized_roi,
            any(pos.primary_bundle_id) as bundle_id,
            toString(max(pos.updated_at)) as as_of_ts,
            any(m.image_url) as image_url
          FROM wio_positions_v2 pos
          LEFT JOIN pm_market_metadata m ON pos.condition_id = m.condition_id
          LEFT JOIN pm_latest_mark_price_v1 mp ON pos.condition_id = mp.condition_id AND pos.outcome_index = mp.outcome_index
          WHERE pos.wallet_id = '${wallet}'
            AND pos.is_resolved = 0
            AND pos.qty_shares_remaining > 0
          GROUP BY pos.condition_id, pos.outcome_index
          ORDER BY sum(pos.cost_usd) DESC
          LIMIT 100
        `,
        format: 'JSONEachRow',
      }),

      // Closed positions with pagination
      // Join with both pm_market_metadata and token map for better coverage
      clickhouse.query({
        query: `
          SELECT
            toString(p.position_id) as position_id,
            p.market_id,
            p.condition_id,
            toUInt8(p.outcome_index) as outcome_index,
            COALESCE(nullIf(m.question, ''), t.question, '') as question,
            COALESCE(nullIf(m.category, ''), t.category, p.category) as category,
            p.side,
            CASE
              WHEN p.qty_shares_opened > 0 THEN p.qty_shares_opened
              WHEN p.qty_shares_closed > 0 THEN p.qty_shares_closed
              ELSE greatest(p.cost_usd, p.proceeds_usd)
            END as shares,
            CASE
              WHEN p.p_entry_side > 0 THEN p.p_entry_side
              WHEN p.qty_shares_opened > 0 THEN p.cost_usd / p.qty_shares_opened
              WHEN p.qty_shares_closed > 0 THEN p.proceeds_usd / p.qty_shares_closed
              ELSE 0
            END as entry_price,
            CASE
              WHEN p.is_resolved = 1 THEN p.payout_rate
              WHEN p.qty_shares_closed > 0 THEN p.proceeds_usd / p.qty_shares_closed
              ELSE 0
            END as exit_price,
            p.cost_usd,
            p.proceeds_usd,
            p.pnl_usd,
            p.roi,
            p.hold_minutes,
            p.brier_score,
            p.is_resolved,
            toString(p.ts_open) as ts_open,
            toString(p.ts_close) as ts_close,
            toString(p.ts_resolve) as ts_resolve,
            m.image_url
          FROM wio_positions_v2 p
          LEFT JOIN pm_market_metadata m ON p.condition_id = m.condition_id
          LEFT JOIN (
            SELECT condition_id, any(question) as question, any(category) as category
            FROM pm_token_to_condition_map_v5
            GROUP BY condition_id
          ) t ON p.condition_id = t.condition_id
          WHERE p.wallet_id = '${wallet}'
          ORDER BY p.ts_open DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        format: 'JSONEachRow',
      }),

      // Count total closed positions
      clickhouse.query({
        query: `
          SELECT count() as total
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const openPositions = (await openResult.json()) as OpenPosition[];
    const closedPositions = (await closedResult.json()) as ClosedPosition[];
    const countRows = (await closedCountResult.json()) as { total: string }[];
    const totalClosed = parseInt(countRows[0]?.total || '0');

    return NextResponse.json({
      success: true,
      open_positions: openPositions,
      open_count: openPositions.length,
      closed_positions: closedPositions,
      closed_count: closedPositions.length,
      pagination: {
        page,
        pageSize,
        totalCount: totalClosed,
        totalPages: Math.ceil(totalClosed / pageSize),
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet/positions] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
