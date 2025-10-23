import { NextRequest, NextResponse } from 'next/server'

/**
 * Polymarket Data API - Market Holders Endpoint
 *
 * Fetches the top holders of a specified market condition
 *
 * Query Parameters:
 * - conditionId: The market condition ID (required)
 * - limit: Max number of holders to return (default: 100, max: 500)
 * - minBalance: Minimum balance to include (default: 1)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const conditionId = searchParams.get('conditionId')
  const limit = parseInt(searchParams.get('limit') || '100')
  const minBalance = parseInt(searchParams.get('minBalance') || '1')

  if (!conditionId) {
    return NextResponse.json(
      { success: false, error: 'conditionId is required' },
      { status: 400 }
    )
  }

  try {
    const url = `https://data-api.polymarket.com/holders?market=${conditionId}&limit=${limit}&minBalance=${minBalance}`

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: 'Market not found' },
          { status: 404 }
        )
      }
      throw new Error(`Polymarket Data API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // Transform the response to a more usable format
    // Polymarket returns array of { token, holders } objects
    const allHolders = data.flatMap((tokenData: any) => {
      const token = tokenData.token
      return (tokenData.holders || []).map((holder: any) => ({
        wallet_address: holder.proxyWallet,
        wallet_alias: holder.pseudonym || holder.name || `${holder.proxyWallet.slice(0, 6)}...${holder.proxyWallet.slice(-4)}`,
        position_shares: holder.amount,
        outcome_index: holder.outcomeIndex,
        outcome_side: holder.outcomeIndex === 0 ? 'NO' : 'YES', // Polymarket convention: index 0 = NO, 1 = YES
        profile_image: holder.profileImageOptimized || holder.profileImage,
        bio: holder.bio,
        display_username: holder.displayUsernamePublic,
        token_id: token,
      }))
    })

    // Separate by outcome
    const yesHolders = allHolders.filter((h: any) => h.outcome_side === 'YES')
    const noHolders = allHolders.filter((h: any) => h.outcome_side === 'NO')

    return NextResponse.json({
      success: true,
      data: {
        all: allHolders,
        yes: yesHolders,
        no: noHolders,
      },
      metadata: {
        conditionId,
        total_holders: allHolders.length,
        yes_holders: yesHolders.length,
        no_holders: noHolders.length,
        limit,
        minBalance,
      }
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error fetching holders:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
