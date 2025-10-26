/**
 * Polymarket Whale Trades API Endpoint (Option 2)
 *
 * Fetches recent trades from Polymarket Data API (public, no auth required) and filters for large trades.
 * A "whale trade" is any trade above the specified threshold (default $10k).
 *
 * GET /api/polymarket/whale-trades/[marketId]?limit=50&minSize=10000
 *
 * Data Source: https://data-api.polymarket.com/trades
 * - Public API (no authentication required)
 * - Includes wallet pseudonyms and profile images
 * - More complete trade context than CLOB API
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
    // Step 1: Get market detail to fetch conditionId (Data API requires conditionId, not marketId)
    const marketResponse = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`)

    if (!marketResponse.ok) {
      if (marketResponse.status === 404) {
        return NextResponse.json(
          {
            success: false,
            error: 'Market not found',
          },
          { status: 404 }
        )
      }
      throw new Error(`Failed to fetch market: ${marketResponse.status}`)
    }

    const marketData = await marketResponse.json()
    const conditionId = marketData.conditionId

    if (!conditionId) {
      throw new Error('Market conditionId not found')
    }

    // Step 2: Fetch recent trades from Polymarket Data API (public, no auth)
    const url = `https://data-api.polymarket.com/trades?market=${conditionId}&limit=${limit}`

    console.log(`[Whale Trades API] Fetching trades for market ${marketId} (condition: ${conditionId})`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store', // Always get fresh data
    })

    if (!response.ok) {
      throw new Error(`Data API error: ${response.status} ${response.statusText}`)
    }

    const trades = await response.json()

    // Filter for whale trades and transform to our format
    const whaleTrades = (trades || [])
      .map((trade: any) => {
        const price = parseFloat(trade.price || 0)
        const size = parseFloat(trade.size || 0)
        const amount_usd = price * size

        return {
          trade_id: trade.transactionHash || `${trade.timestamp}-${trade.proxyWallet}`,
          wallet_address: trade.proxyWallet || 'unknown',
          wallet_alias: trade.pseudonym || (trade.proxyWallet ? `${trade.proxyWallet.slice(0, 6)}...${trade.proxyWallet.slice(-4)}` : 'Unknown'),
          profile_image: trade.profileImageOptimized || trade.profileImage || null,
          timestamp: trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : new Date().toISOString(),
          side: trade.outcome || (trade.side === 'BUY' ? 'YES' : 'NO'),
          action: trade.side === 'BUY' ? 'BUY' : 'SELL',
          shares: size,
          price: price,
          amount_usd: amount_usd,
          market_id: marketId,
          tx_hash: trade.transactionHash,
          // Raw trade data for debugging
          raw: trade,
        }
      })
      .filter((trade: any) => trade.amount_usd >= minSize)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    console.log(`[Whale Trades API] Found ${whaleTrades.length} whale trades (min size: $${minSize}) from ${trades.length} total trades`)

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
