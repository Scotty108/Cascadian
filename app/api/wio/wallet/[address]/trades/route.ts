/**
 * API: Get Wallet Trades (Lazy Load)
 *
 * Returns recent trades for a wallet, grouped by transaction (tx_hash).
 * Each tx_hash represents one user action/decision.
 * Called on-demand when user opens the Trades tab.
 *
 * Path: /api/wio/wallet/[address]/trades
 * Query params:
 * - page: Page number (default 1)
 * - pageSize: Items per page (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface Trade {
  tx_hash: string;
  side: string;
  amount_usd: number;
  shares: number;
  price: number;
  action: string;
  trade_time: string;
  token_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
  image_url: string;
  fill_count: number; // Number of fills in this trade
  roi: number | null; // ROI for sell trades (null for buys)
  avg_entry_price: number | null; // Average cost basis for sell trades
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

    // Get trades grouped by tx_hash (use canonical fills to avoid self-fill issues)
    const [tradesResult, countResult] = await Promise.all([
      clickhouse.query({
        query: `
          SELECT
            f.tx_hash,
            CASE WHEN any(f.tokens_delta) > 0 THEN 'buy' ELSE 'sell' END as side,
            sum(abs(f.usdc_delta)) as amount_usd,
            sum(abs(f.tokens_delta)) as shares,
            sum(abs(f.usdc_delta)) / sum(abs(f.tokens_delta)) as price,
            CASE WHEN any(f.is_maker) = 1 THEN 'maker' ELSE 'taker' END as action,
            toString(min(f.event_time)) as trade_time,
            '' as token_id,
            any(f.condition_id) as condition_id,
            any(f.outcome_index) as outcome_index,
            COALESCE(any(m.question), '') as question,
            COALESCE(any(m.image_url), '') as image_url,
            count(DISTINCT f.fill_id) as fill_count
          FROM pm_canonical_fills_v4 f
          LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
          WHERE f.wallet = '${wallet}'
            AND f.source = 'clob'
          GROUP BY f.tx_hash
          ORDER BY min(f.event_time) DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        format: 'JSONEachRow',
      }),
      clickhouse.query({
        query: `
          SELECT count(DISTINCT tx_hash) as total
          FROM pm_canonical_fills_v4
          WHERE wallet = '${wallet}' AND source = 'clob'
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const rawTrades = (await tradesResult.json()) as Omit<Trade, 'roi' | 'avg_entry_price'>[];
    const countRows = (await countResult.json()) as { total: string }[];
    const totalCount = parseInt(countRows[0]?.total || '0');

    // Get sell trades that need ROI calculation
    const sellTrades = rawTrades.filter(t => t.side === 'sell');

    // Calculate ROI for sells by getting avg cost basis per condition/outcome
    let costBasisMap: Record<string, { avgCost: number }> = {};

    if (sellTrades.length > 0) {
      // Get unique condition_id + outcome_index pairs
      const positions = [...new Set(sellTrades.map(t => `${t.condition_id}|${t.outcome_index}`))];
      const conditionIds = [...new Set(sellTrades.map(t => t.condition_id))];

      const costBasisResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            outcome_index,
            sum(abs(usdc_delta)) / sum(tokens_delta) as avg_cost
          FROM pm_canonical_fills_v4
          WHERE wallet = '${wallet}'
            AND source = 'clob'
            AND condition_id IN (${conditionIds.map(id => `'${id}'`).join(',')})
            AND tokens_delta > 0
          GROUP BY condition_id, outcome_index
          HAVING sum(tokens_delta) > 0
        `,
        format: 'JSONEachRow',
      });
      const costBasisRows = (await costBasisResult.json()) as { condition_id: string; outcome_index: number; avg_cost: number }[];
      costBasisMap = Object.fromEntries(
        costBasisRows.map(r => [`${r.condition_id}|${r.outcome_index}`, { avgCost: r.avg_cost }])
      );
    }

    // Add ROI to trades
    const trades: Trade[] = rawTrades.map(t => {
      const key = `${t.condition_id}|${t.outcome_index}`;
      if (t.side === 'sell' && costBasisMap[key]) {
        const avgEntry = costBasisMap[key].avgCost;
        const roi = avgEntry > 0 ? (t.price - avgEntry) / avgEntry : 0;
        return { ...t, roi, avg_entry_price: avgEntry };
      }
      return { ...t, roi: null, avg_entry_price: null };
    });

    return NextResponse.json({
      success: true,
      trades,
      count: trades.length,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet/trades] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
