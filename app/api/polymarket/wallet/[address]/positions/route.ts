/**
 * Polymarket Wallet Positions API
 *
 * Fetches current open positions for a wallet from Polymarket Data-API
 * GET /api/polymarket/wallet/[address]/positions
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params

  // Validate address format (basic check)
  if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid wallet address format. Expected 0x followed by 40 hex characters.',
      },
      { status: 400 }
    )
  }

  try {
    console.log(`[Positions API] Fetching positions for wallet: ${address}`)

    const response = await fetch(
      `https://data-api.polymarket.com/positions?user=${address}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // No caching - we want fresh position data
        next: { revalidate: 0 },
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const positions = await response.json()

    console.log(`[Positions API] Found ${Array.isArray(positions) ? positions.length : 0} positions for ${address}`)

    // Transform Polymarket API response to match our component's expected format
    const transformedPositions = Array.isArray(positions) ? positions.map((pos: any) => ({
      // Keep original fields
      ...pos,
      // Add transformed fields with correct naming
      market: pos.title || pos.slug,
      question: pos.title,
      side: pos.outcome || 'N/A',
      outcome: pos.outcome,
      shares: pos.size,
      entry_price: pos.avgPrice,
      entryPrice: pos.avgPrice,
      current_price: pos.curPrice,
      currentPrice: pos.curPrice,
      unrealized_pnl: pos.cashPnl,
      unrealizedPnL: pos.cashPnl,
      value: pos.currentValue || pos.initialValue,
      percent_pnl: pos.percentPnl,
      percentPnl: pos.percentPnl,
    })) : []

    return NextResponse.json({
      success: true,
      data: transformedPositions,
      wallet: address,
      count: transformedPositions.length,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Positions API] Error for ${address}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
        wallet: address,
      },
      { status: 500 }
    )
  }
}
