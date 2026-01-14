/**
 * API: Get Wallet PnL History
 *
 * Returns cumulative PnL over time for charting.
 *
 * Path: /api/wio/wallet/[address]/pnl-history
 * Query params:
 * - period: Time period ('1D' | '1W' | '1M' | 'ALL') - default 'ALL'
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface PnLDataPoint {
  timestamp: string;
  daily_pnl: number;
  cumulative_pnl: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || 'ALL';

    // Get last activity date for context
    const lastActivityResult = await clickhouse.query({
      query: `
        SELECT
          max(ts_resolve) as last_resolve,
          count() as total_positions
        FROM wio_positions_v2
        WHERE wallet_id = '${wallet}'
          AND is_resolved = 1
          AND ts_resolve IS NOT NULL
      `,
      format: 'JSONEachRow',
    });
    const lastActivityData = (await lastActivityResult.json()) as { last_resolve: string; total_positions: number }[];
    const lastActivity = lastActivityData[0]?.last_resolve || null;
    const totalPositions = lastActivityData[0]?.total_positions || 0;

    // Calculate date filter based on period
    let dateFilter = '';
    let limitClause = '';
    switch (period) {
      case '1D':
        dateFilter = "AND ts_resolve >= now() - INTERVAL 1 DAY";
        break;
      case '1W':
        dateFilter = "AND ts_resolve >= now() - INTERVAL 7 DAY";
        break;
      case '1M':
        dateFilter = "AND ts_resolve >= now() - INTERVAL 30 DAY";
        break;
      case 'ALL':
      default:
        dateFilter = '';
        break;
    }

    // Use 15-min granularity for 1D, hourly for 1W, 6-hourly for 1M/ALL
    // This gives 4x more data points than before for better chart detail
    let groupBy: string;
    switch (period) {
      case '1D':
        groupBy = 'toStartOfFifteenMinutes(ts_resolve)';  // 4x more granular than hourly
        break;
      case '1W':
        groupBy = 'toStartOfHour(ts_resolve)';  // hourly for 1 week
        break;
      case '1M':
      default:
        groupBy = 'toStartOfInterval(ts_resolve, INTERVAL 6 HOUR)';  // 6-hourly for 1M and ALL
    }

    // First try with the time filter
    let result = await clickhouse.query({
      query: `
        WITH daily_pnl AS (
          SELECT
            ${groupBy} as ts,
            sum(pnl_usd) as period_pnl
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
            AND is_resolved = 1
            AND ts_resolve IS NOT NULL
            ${dateFilter}
          GROUP BY ts
          ORDER BY ts
        )
        SELECT
          toString(ts) as timestamp,
          period_pnl as daily_pnl,
          sum(period_pnl) OVER (ORDER BY ts) as cumulative_pnl
        FROM daily_pnl
        ORDER BY ts
      `,
      format: 'JSONEachRow',
    });

    let data = (await result.json()) as PnLDataPoint[];
    let usingFallback = false;

    // If no data in the time period, fall back to last N data points
    if (data.length === 0 && period !== 'ALL') {
      // More data points for shorter periods to show more detail (4x increase)
      const fallbackLimit = period === '1D' ? 80 : period === '1W' ? 100 : 60;
      // Match the granularity used for the period
      let fallbackGroupBy: string;
      switch (period) {
        case '1D':
          fallbackGroupBy = 'toStartOfFifteenMinutes(ts_resolve)';
          break;
        case '1W':
          fallbackGroupBy = 'toStartOfHour(ts_resolve)';
          break;
        default:
          fallbackGroupBy = 'toStartOfInterval(ts_resolve, INTERVAL 6 HOUR)';
      }

      result = await clickhouse.query({
        query: `
          WITH period_pnl AS (
            SELECT
              ${fallbackGroupBy} as ts,
              sum(pnl_usd) as period_pnl
            FROM wio_positions_v2
            WHERE wallet_id = '${wallet}'
              AND is_resolved = 1
              AND ts_resolve IS NOT NULL
            GROUP BY ts
            ORDER BY ts DESC
            LIMIT ${fallbackLimit}
          )
          SELECT
            toString(ts) as timestamp,
            period_pnl as daily_pnl,
            sum(period_pnl) OVER (ORDER BY ts) as cumulative_pnl
          FROM (SELECT * FROM period_pnl ORDER BY ts)
          ORDER BY ts
        `,
        format: 'JSONEachRow',
      });

      data = (await result.json()) as PnLDataPoint[];
      usingFallback = true;

      // For fallback, we need to add the PnL from before these points
      if (data.length > 0) {
        const firstTimestamp = data[0].timestamp;
        const beforeResult = await clickhouse.query({
          query: `
            SELECT sum(pnl_usd) as pnl_before
            FROM wio_positions_v2
            WHERE wallet_id = '${wallet}'
              AND is_resolved = 1
              AND ts_resolve IS NOT NULL
              AND toDate(ts_resolve) < toDate('${firstTimestamp}')
          `,
          format: 'JSONEachRow',
        });
        const beforeData = (await beforeResult.json()) as { pnl_before: number }[];
        const pnlBefore = beforeData[0]?.pnl_before ?? 0;

        data.forEach((point) => {
          point.cumulative_pnl = point.cumulative_pnl + pnlBefore;
        });
      }
    }

    // Get the total realized PnL for context
    const totalResult = await clickhouse.query({
      query: `
        SELECT sum(pnl_usd) as total_realized_pnl
        FROM wio_positions_v2
        WHERE wallet_id = '${wallet}'
          AND (is_resolved = 1 OR ts_close IS NOT NULL)
      `,
      format: 'JSONEachRow',
    });

    const totalData = (await totalResult.json()) as { total_realized_pnl: number }[];
    const totalRealizedPnl = totalData[0]?.total_realized_pnl ?? 0;

    // If period filter is applied and we have data (not fallback), adjust cumulative values
    if (period !== 'ALL' && data.length > 0 && !usingFallback) {
      const beforeResult = await clickhouse.query({
        query: `
          SELECT sum(pnl_usd) as pnl_before
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
            AND is_resolved = 1
            AND ts_resolve IS NOT NULL
            AND ts_resolve < (now() - INTERVAL ${period === '1D' ? '1 DAY' : period === '1W' ? '7 DAY' : '30 DAY'})
        `,
        format: 'JSONEachRow',
      });

      const beforeData = (await beforeResult.json()) as { pnl_before: number }[];
      const pnlBefore = beforeData[0]?.pnl_before ?? 0;

      data.forEach((point) => {
        point.cumulative_pnl = point.cumulative_pnl + pnlBefore;
      });
    }

    return NextResponse.json({
      success: true,
      data,
      total_realized_pnl: totalRealizedPnl,
      period,
      using_fallback: usingFallback,
      last_activity: lastActivity,
      total_positions: totalPositions,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet/pnl-history] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
