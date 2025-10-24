/**
 * Polymarket Holders via The Graph Subgraph
 *
 * Fetches ALL holders for a specific token ID by querying The Graph's Polymarket PnL subgraph.
 * This bypasses Polymarket's Data API 20-holder limit and provides unlimited holder data
 * with PnL metrics.
 *
 * GET /api/polymarket/holders-graph/[tokenId]?limit=1000&minBalance=1
 */

import { NextRequest, NextResponse } from 'next/server'

const GRAPH_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await params
  const { searchParams } = request.nextUrl

  const limit = parseInt(searchParams.get('limit') || '1000') // Default 1000, can go higher
  const minBalance = searchParams.get('minBalance') || '1' // Minimum balance filter

  try {
    // GraphQL query to fetch user positions for this token
    const query = `
      query GetHolders($tokenId: BigInt!, $limit: Int!, $minBalance: BigInt!) {
        userPositions(
          where: { tokenId: $tokenId, amount_gte: $minBalance }
          first: $limit
          orderBy: amount
          orderDirection: desc
        ) {
          id
          user
          tokenId
          amount
          avgPrice
          realizedPnl
          totalBought
        }
      }
    `

    const response = await fetch(GRAPH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          tokenId,
          limit,
          minBalance,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Graph query failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()

    if (result.errors) {
      console.error('[Holders Graph API] GraphQL errors:', result.errors)
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`)
    }

    const holders = result.data?.userPositions || []

    // Transform to match expected format
    const transformedHolders = holders.map((position: any) => ({
      wallet_address: position.user,
      wallet_alias: `${position.user.slice(0, 6)}...${position.user.slice(-4)}`,
      position_shares: parseFloat(position.amount) / 1e18, // Convert from wei to shares
      avg_entry_price: parseFloat(position.avgPrice) / 1e6, // Convert from micro-units
      realized_pnl: parseFloat(position.realizedPnl) / 1e6, // Convert from micro-units
      total_bought: parseFloat(position.totalBought) / 1e18, // Convert from wei
      unrealized_pnl: 0, // Would need current price to calculate
      token_id: position.tokenId,
    }))

    console.log(`[Holders Graph API] Found ${transformedHolders.length} holders for token ${tokenId}`)

    return NextResponse.json({
      success: true,
      data: transformedHolders,
      metadata: {
        tokenId,
        total_holders: transformedHolders.length,
        limit,
        minBalance,
        source: 'the-graph',
        subgraph: 'polymarket-pnl',
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Holders Graph API] Error for token ${tokenId}:`, message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
