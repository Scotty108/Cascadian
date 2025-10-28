/**
 * Wallet Specialists API
 *
 * GET /api/wallets/specialists
 * Returns top 20 wallets with their category specializations
 * Uses real ClickHouse data for per-category P&L when available
 *
 * Response shape:
 * [
 *   {
 *     wallet_address: string
 *     realized_pnl_usd: number
 *     coverage_pct: number
 *     top_category: string
 *     top_category_pnl_usd: number | null  // null when ClickHouse unavailable
 *     top_category_num_markets: number | null  // null when ClickHouse unavailable
 *     blurb: string
 *   }
 * ]
 */

import { NextResponse } from 'next/server'
import { getTopWalletSpecialists } from '@/lib/analytics/wallet-specialists'

export async function GET() {
  try {
    const specialists = await getTopWalletSpecialists()

    return NextResponse.json(specialists, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    })
  } catch (error) {
    console.error('Error fetching wallet specialists:', error)
    return NextResponse.json(
      { error: 'Failed to fetch wallet specialists' },
      { status: 500 }
    )
  }
}
