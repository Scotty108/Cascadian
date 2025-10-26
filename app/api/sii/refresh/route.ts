import { NextRequest, NextResponse } from 'next/server'
import { refreshMarketSII } from '@/lib/metrics/market-sii'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for batch processing

/**
 * POST /api/sii/refresh
 *
 * Batch refresh SII for multiple markets
 * Used for continuous updates and scheduled refresh
 *
 * Body:
 * {
 *   "market_ids": ["0x...", "0x..."],
 *   "force": true/false
 * }
 *
 * Or call without body to refresh all active markets
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { market_ids, force = false } = body

    let marketsToRefresh: string[] = market_ids || []

    // If no market IDs provided, get all active markets from database
    if (marketsToRefresh.length === 0) {
      const { data: markets } = await supabase
        .from('markets')
        .select('condition_id')
        .eq('active', true)
        .limit(100) // Limit to top 100 active markets

      marketsToRefresh = markets?.map((m) => m.condition_id).filter(Boolean) || []
    }

    if (marketsToRefresh.length === 0) {
      return NextResponse.json({
        error: 'No markets to refresh',
        refreshed: 0,
      })
    }

    console.log(`[SII Refresh] Processing ${marketsToRefresh.length} markets...`)

    // Refresh markets in parallel (with concurrency limit)
    const CONCURRENCY = 5
    const results = []

    for (let i = 0; i < marketsToRefresh.length; i += CONCURRENCY) {
      const batch = marketsToRefresh.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map((marketId) => refreshMarketSII(marketId, undefined, force))
      )
      results.push(...batchResults)
    }

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value !== null).length
    const failed = results.length - successful

    console.log(`[SII Refresh] Complete: ${successful} successful, ${failed} failed`)

    return NextResponse.json({
      success: true,
      total: marketsToRefresh.length,
      refreshed: successful,
      failed,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[SII Refresh] Error:', error)
    return NextResponse.json(
      {
        error: 'Batch refresh failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
