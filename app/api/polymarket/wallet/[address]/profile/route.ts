/**
 * Polymarket Wallet Profile API
 *
 * Fetches user profile data from Polymarket's profile page
 * GET /api/polymarket/wallet/[address]/profile
 */

import { NextRequest, NextResponse } from 'next/server'

interface PolymarketProfile {
  address: string
  username?: string
  pseudonym?: string
  bio?: string
  profilePicture?: string
  twitterHandle?: string
  polymarketUrl?: string
  pnl?: number  // Total PnL from Polymarket
}

// Simple in-memory cache with TTL
const profileCache = new Map<string, { data: PolymarketProfile; timestamp: number }>()
const CACHE_TTL = 1000 * 60 * 60 // 1 hour

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

  const normalizedAddress = address.toLowerCase()

  // Check cache first
  const cached = profileCache.get(normalizedAddress)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      success: true,
      data: cached.data,
      wallet: normalizedAddress,
      cached: true,
    })
  }

  try {
    // Fetch Polymarket profile page
    const profileUrl = `https://polymarket.com/profile/${normalizedAddress}`
    const response = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Cascadian/1.0)',
        'Accept': 'text/html',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) {
      // Return basic profile if page not found
      const basicProfile: PolymarketProfile = { address: normalizedAddress }
      return NextResponse.json({
        success: true,
        data: basicProfile,
        wallet: normalizedAddress,
      })
    }

    const html = await response.text()

    // Extract profile data using regex
    const extractField = (field: string): string | undefined => {
      const regex = new RegExp(`"${field}":"([^"]*)"`)
      const match = html.match(regex)
      return match?.[1] || undefined
    }

    const username = extractField('username') || undefined
    const bio = extractField('bio') || undefined

    const profileData: PolymarketProfile = {
      address: normalizedAddress,
      username,
      pseudonym: extractField('pseudonym') || undefined,
      bio: bio && bio.length > 0 ? bio : undefined,
      profilePicture: extractField('profileImage') || extractField('profileImageOptimized') || undefined,
      // Add Polymarket profile URL if they have a username
      polymarketUrl: username ? `https://polymarket.com/@${username}` : undefined,
    }

    // Try to extract Twitter handle if present
    const twitterMatch = html.match(/"twitter(?:Handle|Username)?":"([^"]+)"/)
    if (twitterMatch && twitterMatch[1]) {
      profileData.twitterHandle = twitterMatch[1]
    }

    // Try to extract PnL from embedded JSON data
    // Polymarket embeds stats in various formats
    const pnlPatterns = [
      /"pnl":\s*(-?[\d.]+)/,
      /"profit":\s*(-?[\d.]+)/,
      /"netProfit":\s*(-?[\d.]+)/,
      /"totalProfit":\s*(-?[\d.]+)/,
      /"profitLoss":\s*(-?[\d.]+)/,
      /"netPnl":\s*(-?[\d.]+)/,
      /"totalPnl":\s*(-?[\d.]+)/,
    ]

    for (const pattern of pnlPatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        const pnlValue = parseFloat(match[1])
        if (!isNaN(pnlValue) && Math.abs(pnlValue) > 0.01) {
          profileData.pnl = pnlValue
          break
        }
      }
    }

    // Cache the result
    profileCache.set(normalizedAddress, {
      data: profileData,
      timestamp: Date.now(),
    })

    return NextResponse.json({
      success: true,
      data: profileData,
      wallet: normalizedAddress,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Profile API] Error for ${address}:`, message)

    // Return basic profile on error
    return NextResponse.json({
      success: true,
      data: { address: normalizedAddress },
      wallet: normalizedAddress,
      error: message,
    })
  }
}
