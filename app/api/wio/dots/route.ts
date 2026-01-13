/**
 * API: Get WIO Dots (Smart Money Signals)
 *
 * Returns recent trading signals from smart money wallets.
 *
 * Query params:
 * - limit: Number of dots to return (default 50, max 200)
 * - tier: Filter by wallet tier ('S', 'A', 'B')
 * - bundle: Filter by bundle_id
 * - category: Filter by category
 * - since: ISO timestamp to get dots after
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface Dot {
  dot_id: string;
  dot_type: string;
  wallet_id: string;
  market_id: string;
  side: string;
  position_size_usd: number;
  entry_price: number;
  wallet_tier: string;
  wallet_rank: number;
  wallet_roi: number;
  market_question: string;
  category: string;
  bundle_id: string;
  ts: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200);
    const tier = searchParams.get('tier');
    const bundle = searchParams.get('bundle');
    const category = searchParams.get('category');
    const since = searchParams.get('since');

    // Build WHERE clauses
    const conditions: string[] = [];

    if (tier) {
      conditions.push(`wallet_tier = '${tier}'`);
    }
    if (bundle) {
      conditions.push(`bundle_id = '${bundle}'`);
    }
    if (category) {
      conditions.push(`category = '${category}'`);
    }
    if (since) {
      conditions.push(`ts > toDateTime('${since}', 'UTC')`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const query = `
      SELECT
        toString(dot_id) as dot_id,
        dot_type,
        wallet_id,
        market_id,
        side,
        position_size_usd,
        entry_price,
        wallet_tier,
        wallet_rank,
        wallet_roi,
        market_question,
        category,
        bundle_id,
        toString(ts) as ts
      FROM wio_dots_v1
      ${whereClause}
      ORDER BY ts DESC
      LIMIT ${limit}
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const dots = (await result.json()) as Dot[];

    return NextResponse.json({
      success: true,
      count: dots.length,
      dots,
    });

  } catch (error: any) {
    console.error('[wio/dots] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      dots: [],
    }, { status: 500 });
  }
}
