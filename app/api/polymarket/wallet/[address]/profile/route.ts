/**
 * Polymarket Wallet Profile API
 *
 * Fetches user profile data from Polymarket
 * GET /api/polymarket/wallet/[address]/profile
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
    console.log(`[Profile API] Fetching profile for wallet: ${address}`)

    // Try to fetch profile from Polymarket API
    // Note: Polymarket may not have a public profile endpoint, so we'll use what's available
    // The main profile data comes from their subgraph or user endpoints

    // For now, we'll return basic profile structure
    // In production, you might fetch from Polymarket's user API or subgraph
    const profileData = {
      address,
      // These would come from Polymarket API in production:
      // username: response.username,
      // bio: response.bio,
      // profilePicture: response.profilePicture,
      // twitterHandle: response.twitterHandle,
      // websiteUrl: response.websiteUrl,
    }

    console.log(`[Profile API] Profile data for ${address}:`, profileData)

    return NextResponse.json({
      success: true,
      data: profileData,
      wallet: address,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Profile API] Error for ${address}:`, message)

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
