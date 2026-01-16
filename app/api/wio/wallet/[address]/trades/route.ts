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

    // Get trades grouped by tx_hash (exclude maker side of self-fills to avoid double-counting)
    const [tradesResult, countResult] = await Promise.all([
      clickhouse.query({
        query: `
          WITH self_fill_txs AS (
            SELECT trader_wallet, transaction_hash
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${wallet}' AND is_deleted = 0
            GROUP BY trader_wallet, transaction_hash
            HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
          ),
          deduped_fills AS (
            SELECT
              event_id,
              any(transaction_hash) as transaction_hash,
              any(side) as side,
              any(usdc_amount) as usdc_amount,
              any(token_amount) as token_amount,
              any(role) as role,
              any(trade_time) as trade_time,
              any(token_id) as token_id
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${wallet}'
              AND is_deleted = 0
              AND NOT (
                (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs)
                AND role = 'maker'
              )
            GROUP BY event_id
          )
          SELECT
            t.transaction_hash as tx_hash,
            any(t.side) as side,
            sum(t.usdc_amount) / 1000000.0 as amount_usd,
            sum(t.token_amount) / 1000000.0 as shares,
            CASE WHEN sum(t.token_amount) > 0 THEN sum(t.usdc_amount) / sum(t.token_amount) ELSE 0 END as price,
            any(t.role) as action,
            toString(min(t.trade_time)) as trade_time,
            any(t.token_id) as token_id,
            any(tm.condition_id) as condition_id,
            any(tm.outcome_index) as outcome_index,
            COALESCE(any(tm.question), '') as question,
            COALESCE(any(m.image_url), '') as image_url,
            count() as fill_count
          FROM deduped_fills t
          LEFT JOIN pm_token_to_condition_map_current tm ON t.token_id = tm.token_id_dec
          LEFT JOIN pm_market_metadata m ON tm.condition_id = m.condition_id
          GROUP BY t.transaction_hash
          ORDER BY min(t.trade_time) DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        format: 'JSONEachRow',
      }),
      clickhouse.query({
        query: `
          WITH self_fill_txs AS (
            SELECT trader_wallet, transaction_hash
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${wallet}' AND is_deleted = 0
            GROUP BY trader_wallet, transaction_hash
            HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
          )
          SELECT count(DISTINCT transaction_hash) as total
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}'
            AND is_deleted = 0
            AND NOT (
              (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs)
              AND role = 'maker'
            )
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
          WITH fills_deduped AS (
            SELECT
              fill_id,
              argMax(condition_id, fill_id) as condition_id,
              argMax(outcome_index, fill_id) as outcome_index,
              argMax(tokens_delta, fill_id) as tokens_delta,
              argMax(usdc_delta, fill_id) as usdc_delta
            FROM pm_canonical_fills_v4
            WHERE wallet = '${wallet}'
              AND source = 'clob'
              AND condition_id IN (${conditionIds.map(id => `'${id}'`).join(',')})
              AND tokens_delta > 0
            GROUP BY fill_id
          )
          SELECT
            condition_id,
            outcome_index,
            sum(abs(usdc_delta)) / sum(tokens_delta) as avg_cost
          FROM fills_deduped
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
