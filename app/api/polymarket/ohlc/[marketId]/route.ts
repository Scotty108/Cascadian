/**
 * Polymarket OHLC Price History API Endpoint
 *
 * Fetches OHLC (Open, High, Low, Close) price data from Polymarket CLOB API
 * Used for candlestick charts and price history visualization
 *
 * GET /api/polymarket/ohlc/[marketId]
 * Query params:
 *   - interval: string (default: "max") - Time interval (1m, 1h, 1d, 1w, max)
 *   - fidelity: number (optional) - Data resolution in minutes
 *   - startTs: number - Start timestamp (Unix seconds)
 *   - endTs: number - End timestamp (Unix seconds)
 *
 * Use interval="max" to get all available historical data (~30 days, 700+ points)
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params
  const { searchParams } = new URL(request.url)

  // Parse query parameters
  // Default to "max" to get all available historical data
  const interval = searchParams.get('interval') || 'max'
  const fidelity = searchParams.get('fidelity') // Optional - let Polymarket decide for "max"
  const startTs = searchParams.get('startTs')
  const endTs = searchParams.get('endTs')

  try {
    console.log(`[OHLC API] Fetching price history for market: ${marketId}, interval: ${interval}`)

    // Build Polymarket CLOB API URL
    const params = new URLSearchParams({
      market: marketId,
      interval: interval,
    })

    // Only add fidelity if specified (for "max", Polymarket determines optimal fidelity)
    if (fidelity) {
      params.set('fidelity', fidelity)
    }

    if (startTs) {
      params.set('startTs', startTs)
    }
    if (endTs) {
      params.set('endTs', endTs)
    }

    const url = `https://clob.polymarket.com/prices-history?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 60 }, // Cache for 1 minute
    })

    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const history = data.history || []

    // Transform to OHLC format for charts
    // Polymarket returns simple price points { t, p }, we'll use them as close prices
    const ohlc = history.map((point: any) => ({
      t: point.t, // Unix timestamp in seconds
      o: point.p, // Use price as open
      h: point.p, // Use price as high
      l: point.p, // Use price as low
      c: point.p, // Price is close
      v: null, // Volume not provided in simple price history
    }))

    console.log(`[OHLC API] Fetched ${ohlc.length} data points for market ${marketId}`)

    return NextResponse.json({
      success: true,
      data: ohlc,
      metadata: {
        marketId,
        interval,
        startTs: startTs ? parseInt(startTs) : null,
        endTs: endTs ? parseInt(endTs) : null,
        count: ohlc.length,
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[OHLC API] Error for market ${marketId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
