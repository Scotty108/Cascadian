/**
 * Polymarket Order Book API Endpoint
 *
 * Fetches live order book data from Polymarket CLOB API
 * Used for displaying current bids and asks
 *
 * GET /api/polymarket/order-book/[marketId]
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params

  try {
    // Fetch from Polymarket CLOB API
    const url = `https://clob.polymarket.com/book?token_id=${marketId}`

    console.log(`[Order Book API] Fetching: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
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

    const orderBook = await response.json()

    // Transform to standard format
    const transformed = {
      bids: (orderBook.bids || []).map((bid: any) => ({
        price: parseFloat(bid.price),
        size: parseFloat(bid.size),
      })),
      asks: (orderBook.asks || []).map((ask: any) => ({
        price: parseFloat(ask.price),
        size: parseFloat(ask.size),
      })),
      spread: orderBook.spread ? parseFloat(orderBook.spread) : null,
      timestamp: Date.now(),
      marketId,
    }

    console.log(`[Order Book API] Fetched ${transformed.bids.length} bids, ${transformed.asks.length} asks`)

    return NextResponse.json({
      success: true,
      data: transformed,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Order Book API] Error for market ${marketId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
