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

    // Transform Polymarket API response to match our component's expected format
    const transformedTrades = Array.isArray(trades) ? trades.map((trade: any) => {
      // Convert Unix timestamp (seconds) to ISO string
      const isoTimestamp = trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : null

      return {
        // Keep original fields but exclude raw timestamp to avoid confusion
        proxyWallet: trade.proxyWallet,
        side: trade.side,
        asset: trade.asset,
        conditionId: trade.conditionId,
        size: trade.size,
        price: trade.price,
        title: trade.title,
        slug: trade.slug,
        icon: trade.icon,
        eventSlug: trade.eventSlug,
        outcome: trade.outcome,
        outcomeIndex: trade.outcomeIndex,
        name: trade.name,
        pseudonym: trade.pseudonym,
        bio: trade.bio,
        profileImage: trade.profileImage,
        profileImageOptimized: trade.profileImageOptimized,
        transactionHash: trade.transactionHash,

        // Add transformed fields for component compatibility
        market: trade.title || trade.slug,
        question: trade.title,
        action: trade.side,
        type: trade.side,
        shares: trade.size,
        amount: (trade.size || 0) * (trade.price || 0),
        amount_usd: (trade.size || 0) * (trade.price || 0),
        timestamp: isoTimestamp, // Use ISO string format instead of Unix seconds
        created_at: isoTimestamp,
        id: trade.transactionHash || `${trade.proxyWallet}-${trade.timestamp}`,
        trade_id: trade.transactionHash,
      }
    }) : []

    return NextResponse.json({
      success: true,
      data: transformedTrades,
      wallet: address,
      count: transformedTrades.length,
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
