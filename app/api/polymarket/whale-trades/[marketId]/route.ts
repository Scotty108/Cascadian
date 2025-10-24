/**
 * Polymarket Whale Trades API Endpoint (Option 2)
 *
 * Fetches recent trades from Polymarket CLOB API and filters for large trades.
 * A "whale trade" is any trade above the specified threshold (default $10k).
 *
 * GET /api/polymarket/whale-trades/[marketId]?limit=50&minSize=10000
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params
  const { searchParams } = request.nextUrl

  const limit = parseInt(searchParams.get('limit') || '100')
  const minSize = parseFloat(searchParams.get('minSize') || '10000') // $10k default

  try {
    // Fetch recent trades from Polymarket CLOB API
    const url = `https://clob.polymarket.com/trades?market=${marketId}&limit=${limit}`

    console.log(`[Whale Trades API] Fetching: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store', // Always get fresh data
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          {
            success: false,
            error: 'Market not found',
          },
          { status: 404 }
        )
      }

      throw new Error(`CLOB API error: ${response.status} ${response.statusText}`)
    }

    const trades = await response.json()

    // Filter for whale trades and transform to our format
    const whaleTrades = (trades || [])
      .map((trade: any) => {
        const price = parseFloat(trade.price || 0)
        const size = parseFloat(trade.size || 0)
        const amount_usd = price * size

        return {
          trade_id: trade.id || `${trade.timestamp}-${trade.maker_address}`,
          wallet_address: trade.maker_address || trade.taker_address || 'unknown',
          wallet_alias: trade.maker_address ? `${trade.maker_address.slice(0, 6)}...${trade.maker_address.slice(-4)}` : 'Unknown',
          timestamp: trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : new Date().toISOString(),
          side: trade.side === 'BUY' || trade.side === 'buy' ? 'YES' : 'NO',
          action: trade.side === 'BUY' || trade.side === 'buy' ? 'BUY' : 'SELL',
          shares: size,
          price: price,
          amount_usd: amount_usd,
          market_id: marketId,
          // Raw trade data for debugging
          raw: trade,
        }
      })
      .filter((trade: any) => trade.amount_usd >= minSize)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    console.log(`[Whale Trades API] Found ${whaleTrades.length} whale trades (min size: $${minSize})`)

    return NextResponse.json({
      success: true,
      data: whaleTrades,
      count: whaleTrades.length,
      filters: {
        minSize,
        limit,
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Whale Trades API] Error for market ${marketId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
