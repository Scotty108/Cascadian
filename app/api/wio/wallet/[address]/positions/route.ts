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
      // Open positions directly from pm_canonical_fills_v4 using V55 PnL formula
      // Formula: cash_flow + (net_tokens × mark_price)
      // This correctly accounts for partial sells (realized gains) + remaining value
      clickhouse.query({
        query: `
          SELECT
            f.condition_id as market_id,
            f.condition_id as condition_id,
            f.outcome_index as outcome_index,
            COALESCE(any(m.question), any(p.question), '') as question,
            COALESCE(any(m.category), any(p.category), '') as category,
            CASE WHEN f.outcome_index = 0 THEN 'NO' ELSE 'YES' END as side,
            sum(f.tokens_delta) as open_shares_net,
            -- Cost is total spent (negative usdc_delta means money out)
            -sumIf(f.usdc_delta, f.usdc_delta < 0) as open_cost_usd,
            -- Avg entry = total cost / total shares bought
            CASE WHEN sumIf(f.tokens_delta, f.tokens_delta > 0) > 0
              THEN -sumIf(f.usdc_delta, f.usdc_delta < 0) / sumIf(f.tokens_delta, f.tokens_delta > 0)
              ELSE 0
            END as avg_entry_price,
            COALESCE(any(mp.mark_price), 0.5) as mark_price,
            -- V55 formula: cash_flow + MTM (includes realized gains from partial sells)
            sum(f.usdc_delta) + sum(f.tokens_delta) * COALESCE(any(mp.mark_price), 0.5) as unrealized_pnl_usd,
            -- ROI = pnl / cost
            CASE WHEN -sumIf(f.usdc_delta, f.usdc_delta < 0) > 0
              THEN (sum(f.usdc_delta) + sum(f.tokens_delta) * COALESCE(any(mp.mark_price), 0.5)) / -sumIf(f.usdc_delta, f.usdc_delta < 0)
              ELSE 0
            END as unrealized_roi,
            '' as bundle_id,
            toString(max(f.event_time)) as as_of_ts,
            any(m.image_url) as image_url
          FROM pm_canonical_fills_v4 f
          LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
          LEFT JOIN pm_token_to_condition_patch p ON f.condition_id = p.condition_id
          LEFT JOIN pm_latest_mark_price_v1 mp ON f.condition_id = mp.condition_id AND f.outcome_index = mp.outcome_index
          LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.wallet = '${wallet}'
            AND f.condition_id != ''
            AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
            AND f.source != 'negrisk'
            -- Only unresolved positions
            AND (r.resolved_at IS NULL OR r.resolved_at <= '1970-01-02')
          GROUP BY f.condition_id, f.outcome_index
          HAVING sum(f.tokens_delta) > 0.001  -- Has remaining shares (open position)
          ORDER BY -sumIf(f.usdc_delta, f.usdc_delta < 0) DESC
          LIMIT 100
        `,
        format: 'JSONEachRow',
      }),

      // Closed positions directly from pm_canonical_fills_v4 using V55 PnL formula
      // Shows all positions for history view
      clickhouse.query({
        query: `
          SELECT
            toString(cityHash64(concat('${wallet}', f.condition_id, toString(f.outcome_index)))) as position_id,
            f.condition_id as market_id,
            f.condition_id as condition_id,
            f.outcome_index as outcome_index,
            COALESCE(any(m.question), any(t.question), '') as question,
            COALESCE(any(m.category), any(t.category), '') as category,
            CASE WHEN f.outcome_index = 0 THEN 'NO' ELSE 'YES' END as side,
            sumIf(f.tokens_delta, f.tokens_delta > 0) as shares,
            -- Entry price = cost / shares bought
            CASE WHEN sumIf(f.tokens_delta, f.tokens_delta > 0) > 0
              THEN -sumIf(f.usdc_delta, f.usdc_delta < 0) / sumIf(f.tokens_delta, f.tokens_delta > 0)
              ELSE 0
            END as entry_price,
            -- Exit price: resolved payout OR avg sell price OR mark price
            CASE
              WHEN any(r.payout_numerators) IS NOT NULL AND any(r.payout_numerators) != '' THEN
                CASE
                  WHEN any(r.payout_numerators) = '[1,1]' THEN 0.5
                  WHEN any(r.payout_numerators) = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                  WHEN any(r.payout_numerators) = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                  ELSE 0.0
                END
              WHEN sumIf(abs(f.tokens_delta), f.tokens_delta < 0) > 0
                THEN sumIf(f.usdc_delta, f.usdc_delta > 0) / sumIf(abs(f.tokens_delta), f.tokens_delta < 0)
              ELSE COALESCE(any(mp.mark_price), 0.5)
            END as exit_price,
            -sumIf(f.usdc_delta, f.usdc_delta < 0) as cost_usd,
            sumIf(f.usdc_delta, f.usdc_delta > 0) as proceeds_usd,
            -- V55 formula: cash_flow + MTM (for resolved: MTM = remaining_shares * payout_rate)
            sum(f.usdc_delta) + sum(f.tokens_delta) * CASE
              WHEN any(r.payout_numerators) IS NOT NULL AND any(r.payout_numerators) != '' THEN
                CASE
                  WHEN any(r.payout_numerators) = '[1,1]' THEN 0.5
                  WHEN any(r.payout_numerators) = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                  WHEN any(r.payout_numerators) = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                  ELSE 0.0
                END
              ELSE COALESCE(any(mp.mark_price), 0.5)
            END as pnl_usd,
            -- ROI = pnl / cost
            CASE WHEN -sumIf(f.usdc_delta, f.usdc_delta < 0) > 0
              THEN (sum(f.usdc_delta) + sum(f.tokens_delta) * CASE
                WHEN any(r.payout_numerators) IS NOT NULL AND any(r.payout_numerators) != '' THEN
                  CASE
                    WHEN any(r.payout_numerators) = '[1,1]' THEN 0.5
                    WHEN any(r.payout_numerators) = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                    WHEN any(r.payout_numerators) = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                    ELSE 0.0
                  END
                ELSE COALESCE(any(mp.mark_price), 0.5)
              END) / -sumIf(f.usdc_delta, f.usdc_delta < 0)
              ELSE 0
            END as roi,
            dateDiff('minute', min(f.event_time), max(f.event_time)) as hold_minutes,
            NULL as brier_score,
            CASE WHEN any(r.resolved_at) IS NOT NULL AND any(r.resolved_at) > '1970-01-02' THEN 1 ELSE 0 END as is_resolved,
            toString(min(f.event_time)) as ts_open,
            toString(max(f.event_time)) as ts_close,
            toString(any(r.resolved_at)) as ts_resolve,
            any(m.image_url) as image_url
          FROM pm_canonical_fills_v4 f
          LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
          LEFT JOIN pm_latest_mark_price_v1 mp ON f.condition_id = mp.condition_id AND f.outcome_index = mp.outcome_index
          LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
          LEFT JOIN (
            SELECT condition_id, any(question) as question, any(category) as category
            FROM pm_token_to_condition_map_v5
            GROUP BY condition_id
            UNION ALL
            SELECT condition_id, any(question) as question, any(category) as category
            FROM pm_token_to_condition_patch
            GROUP BY condition_id
          ) t ON f.condition_id = t.condition_id
          WHERE f.wallet = '${wallet}'
            AND f.condition_id != ''
            AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
            AND f.source != 'negrisk'
          GROUP BY f.condition_id, f.outcome_index
          ORDER BY min(f.event_time) DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        format: 'JSONEachRow',
      }),

      // Count total unique positions from pm_canonical_fills_v4
      clickhouse.query({
        query: `
          SELECT count() as total
          FROM (
            SELECT condition_id, outcome_index
            FROM pm_canonical_fills_v4
            WHERE wallet = '${wallet}'
              AND condition_id != ''
              AND NOT (is_self_fill = 1 AND is_maker = 1)
              AND source != 'negrisk'
            GROUP BY condition_id, outcome_index
          )
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
