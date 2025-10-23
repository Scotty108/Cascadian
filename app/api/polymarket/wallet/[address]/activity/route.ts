/**
 * Polymarket Wallet Activity API
 *
 * Fetches user activity log from Polymarket Data-API
 * GET /api/polymarket/wallet/[address]/activity?limit=50
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '50'

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
    console.log(`[Activity API] Fetching activity for wallet: ${address} (limit: ${limit})`)

    const response = await fetch(
      `https://data-api.polymarket.com/activity?user=${address}&limit=${limit}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Short cache for activity feed
        next: { revalidate: 30 },
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const activity = await response.json()

    console.log(`[Activity API] Found ${Array.isArray(activity) ? activity.length : 0} activity items for ${address}`)

    return NextResponse.json({
      success: true,
      data: activity,
      wallet: address,
      count: Array.isArray(activity) ? activity.length : 0,
      limit: parseInt(limit),
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Activity API] Error for ${address}:`, message)

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
