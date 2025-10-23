/**
 * Polymarket Wallet Closed Positions API
 *
 * Fetches settled/closed positions with realized PnL from Polymarket Data-API
 * GET /api/polymarket/wallet/[address]/closed-positions?limit=100
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '100'

  // Validate address format
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
    console.log(`[Closed Positions API] Fetching closed positions for wallet: ${address} (limit: ${limit})`)

    const response = await fetch(
      `https://data-api.polymarket.com/closed-positions?user=${address}&limit=${limit}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Cache closed positions longer - they don't change
        next: { revalidate: 300 }, // 5 minutes
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const closedPositions = await response.json()

    console.log(`[Closed Positions API] Found ${Array.isArray(closedPositions) ? closedPositions.length : 0} closed positions for ${address}`)

    return NextResponse.json({
      success: true,
      data: closedPositions,
      wallet: address,
      count: Array.isArray(closedPositions) ? closedPositions.length : 0,
      limit: parseInt(limit),
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Closed Positions API] Error for ${address}:`, message)

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
