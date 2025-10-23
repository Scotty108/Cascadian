/**
 * Polymarket Wallet Trades API
 *
 * Fetches trade history for a wallet from Polymarket Data-API
 * GET /api/polymarket/wallet/[address]/trades?limit=100
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
    console.log(`[Trades API] Fetching trades for wallet: ${address} (limit: ${limit})`)

    const response = await fetch(
      `https://data-api.polymarket.com/trades?user=${address}&limit=${limit}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Short cache - trade history doesn't change often
        next: { revalidate: 30 },
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const trades = await response.json()

    console.log(`[Trades API] Found ${Array.isArray(trades) ? trades.length : 0} trades for ${address}`)

    return NextResponse.json({
      success: true,
      data: trades,
      wallet: address,
      count: Array.isArray(trades) ? trades.length : 0,
      limit: parseInt(limit),
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Trades API] Error for ${address}:`, message)

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
