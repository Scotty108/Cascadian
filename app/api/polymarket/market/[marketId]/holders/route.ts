/**
 * Polymarket Market Holders API
 *
 * Fetches top holders for a specific market from Polymarket Data-API
 * GET /api/polymarket/market/[marketId]/holders?limit=50
 *
 * Note: marketId should be the clobTokenId for the specific outcome
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '50'

  try {
    console.log(`[Holders API] Fetching holders for market: ${marketId} (limit: ${limit})`)

    // Try different parameter formats since we're not sure which works
    const endpoints = [
      `https://data-api.polymarket.com/holders?market=${marketId}&limit=${limit}`,
      `https://data-api.polymarket.com/holders?marketId=${marketId}&limit=${limit}`,
      `https://data-api.polymarket.com/holders?tokenId=${marketId}&limit=${limit}`,
      `https://data-api.polymarket.com/holders?token=${marketId}&limit=${limit}`,
    ]

    let holders = null
    let successfulEndpoint = null

    // Try each endpoint until one works
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Cascadian-Intelligence/1.0',
          },
          next: { revalidate: 60 }, // 1 minute cache
        })

        if (response.ok) {
          const data = await response.json()
          // Check if we got an error message or actual data
          if (!data.error && data) {
            holders = data
            successfulEndpoint = endpoint
            break
          }
        }
      } catch (e) {
        // Try next endpoint
        continue
      }
    }

    if (!holders) {
      // None of the endpoints worked
      console.warn(`[Holders API] Could not fetch holders for market ${marketId} - tried ${endpoints.length} endpoint formats`)
      return NextResponse.json({
        success: false,
        error: 'Unable to fetch holders data. The Data-API endpoint format may have changed.',
        marketId,
        triedEndpoints: endpoints,
      }, { status: 503 })
    }

    console.log(`[Holders API] Found ${Array.isArray(holders) ? holders.length : 0} holders for market ${marketId}`)
    console.log(`[Holders API] Successful endpoint: ${successfulEndpoint}`)

    return NextResponse.json({
      success: true,
      data: holders,
      marketId,
      count: Array.isArray(holders) ? holders.length : 0,
      limit: parseInt(limit),
      endpoint: successfulEndpoint, // Log which endpoint worked for debugging
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Holders API] Error for market ${marketId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
        marketId,
      },
      { status: 500 }
    )
  }
}
