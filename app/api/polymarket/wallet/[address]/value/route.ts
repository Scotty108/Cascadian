/**
 * Polymarket Wallet Total Value API
 *
 * Fetches total USDC value of wallet holdings from Polymarket Data-API
 * GET /api/polymarket/wallet/[address]/value
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params

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
    console.log(`[Value API] Fetching total value for wallet: ${address}`)

    const response = await fetch(
      `https://data-api.polymarket.com/value?user=${address}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Fresh data for portfolio value
        next: { revalidate: 0 },
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const valueResponse = await response.json()

    // Extract value from array response (Polymarket API returns array with single object)
    let portfolioValue = 0
    if (Array.isArray(valueResponse) && valueResponse.length > 0) {
      portfolioValue = valueResponse[0].value || 0
    } else if (typeof valueResponse === 'object' && valueResponse.value) {
      portfolioValue = valueResponse.value
    }

    console.log(`[Value API] Portfolio value for ${address}: $${portfolioValue.toFixed(2)}`)

    return NextResponse.json({
      success: true,
      data: {
        value: portfolioValue,
        user: address,
      },
      wallet: address,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Value API] Error for ${address}:`, message)

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
