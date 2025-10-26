import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/wallets/[address]/score
 *
 * Returns Omega score and performance metrics for a wallet
 *
 * Query params:
 * - fresh: If 'true', recalculates score instead of using cached value
 * - ttl: Cache TTL in seconds (default: 3600 = 1 hour)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params
    const searchParams = request.nextUrl.searchParams
    const fresh = searchParams.get('fresh') === 'true'
    const ttl = parseInt(searchParams.get('ttl') || '3600')

    if (!address) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 })
    }

    const walletAddress = address.toLowerCase()

    // Check cache first (unless fresh requested)
    if (!fresh) {
      const { data: cached, error } = await supabase
        .from('wallet_scores')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single()

      if (!error && cached) {
        // Check if cache is fresh enough
        const cacheAge = Date.now() - new Date(cached.calculated_at).getTime()
        const cacheAgeSec = cacheAge / 1000

        if (cacheAgeSec < ttl) {
          return NextResponse.json({
            ...cached,
            cached: true,
            cache_age_seconds: Math.floor(cacheAgeSec),
          })
        }
      }
    }

    // Calculate fresh score
    console.log(`[API] Calculating fresh Omega score for ${walletAddress}`)
    const score = await calculateWalletOmegaScore(walletAddress)

    if (!score) {
      return NextResponse.json(
        {
          error: 'No PnL data found for this wallet',
          wallet_address: walletAddress,
        },
        { status: 404 }
      )
    }

    // Save to cache
    await supabase.from('wallet_scores').upsert(
      {
        wallet_address: score.wallet_address,
        omega_ratio: score.omega_ratio,
        omega_momentum: score.omega_momentum,
        total_positions: score.total_positions,
        closed_positions: score.closed_positions,
        total_pnl: score.total_pnl,
        total_gains: score.total_gains,
        total_losses: score.total_losses,
        win_rate: score.win_rate,
        avg_gain: score.avg_gain,
        avg_loss: score.avg_loss,
        momentum_direction: score.momentum_direction,
        grade: score.grade,
        meets_minimum_trades: score.meets_minimum_trades,
        calculated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet_address',
      }
    )

    return NextResponse.json({
      ...score,
      cached: false,
      cache_age_seconds: 0,
    })
  } catch (error) {
    console.error('[API] Error calculating wallet score:', error)
    return NextResponse.json(
      {
        error: 'Failed to calculate wallet score',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
