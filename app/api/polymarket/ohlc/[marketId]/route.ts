/**
 * Polymarket OHLC Price History API Endpoint
 *
 * Fetches OHLC (Open, High, Low, Close) price data from database
 * Used for candlestick charts and price history visualization
 *
 * GET /api/polymarket/ohlc/[marketId]
 * Query params:
 *   - interval: string (default: "1m") - Time interval (1m, 5m, 1h, etc.)
 *   - limit: number (default: 100) - Number of data points
 *   - startTs: number - Start timestamp (Unix seconds)
 *   - endTs: number - End timestamp (Unix seconds)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params
  const { searchParams } = new URL(request.url)

  // Parse query parameters
  const interval = searchParams.get('interval') || '1m'
  const limit = parseInt(searchParams.get('limit') || '100')
  const startTs = searchParams.get('startTs')
  const endTs = searchParams.get('endTs')

  try {
    console.log(`[OHLC API] Fetching price history for market: ${marketId}`)

    // Build query for prices_1m table
    let query = supabaseAdmin
      .from('prices_1m')
      .select('ts, open, high, low, close, volume, trade_count, bid, ask')
      .eq('market_id', marketId)
      .order('ts', { ascending: true })
      .limit(limit)

    // Apply time range filters if provided
    if (startTs) {
      const startDate = new Date(parseInt(startTs) * 1000).toISOString()
      query = query.gte('ts', startDate)
    }

    if (endTs) {
      const endDate = new Date(parseInt(endTs) * 1000).toISOString()
      query = query.lte('ts', endDate)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Database error: ${error.message}`)
    }

    // Transform to OHLC format for charts
    const ohlc = (data || []).map(row => ({
      t: new Date(row.ts).getTime() / 1000, // Unix timestamp in seconds
      o: row.open ? parseFloat(String(row.open)) : null,
      h: row.high ? parseFloat(String(row.high)) : null,
      l: row.low ? parseFloat(String(row.low)) : null,
      c: row.close ? parseFloat(String(row.close)) : null,
      v: row.volume ? parseFloat(String(row.volume)) : null,
      bid: row.bid ? parseFloat(String(row.bid)) : null,
      ask: row.ask ? parseFloat(String(row.ask)) : null,
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
