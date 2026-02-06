/**
 * Wallet Category Breakdown API Endpoint
 *
 * GET /api/wallets/[address]/category-breakdown
 *
 * Returns realized P&L breakdown by category for a wallet
 * Uses pm_trade_fifo_roi_v3 JOIN pm_market_metadata for category data
 *
 * Only returns data for resolved trades with nonzero P&L
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CategoryBreakdown {
  canonical_category: string
  pnl_usd: number
  num_trades: number
  num_resolved_markets: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params

    console.log(`Fetching category breakdown for ${address}...`)

    // Query ClickHouse using pm_trade_fifo_roi_v3 + pm_market_metadata
    const result = await clickhouse.query({
      query: `
        SELECT
          COALESCE(m.category, 'Uncategorized') AS canonical_category,
          SUM(f.pnl_usd) AS pnl_usd,
          COUNT(*) AS num_trades,
          COUNT(DISTINCT f.condition_id) AS num_resolved_markets
        FROM pm_trade_fifo_roi_v3 f
        LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
        WHERE f.wallet = {wallet:String}
          AND f.pnl_usd != 0
        GROUP BY COALESCE(m.category, 'Uncategorized')
        ORDER BY pnl_usd DESC
      `,
      query_params: {
        wallet: address.toLowerCase(),
      },
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as CategoryBreakdown[]

    // Check if we have data
    if (rows.length === 0) {
      console.log(`   No resolved P&L data found for ${address}`)

      return NextResponse.json({
        success: true,
        data: [],
        partial: true,
        reason: 'pnl_not_populated',
        message:
          'No resolved trades with P&L found. P&L backfill may not be complete for this wallet.',
      })
    }

    // Filter out empty categories (null/empty string)
    const validRows = rows.filter(
      (row) => row.canonical_category && row.canonical_category.trim() !== ''
    )

    console.log(`   Found ${validRows.length} categories with P&L`)

    return NextResponse.json(
      {
        success: true,
        data: validRows,
        partial: false,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
        },
      }
    )
  } catch (error: any) {
    console.error('Error fetching category breakdown:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch category breakdown',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
