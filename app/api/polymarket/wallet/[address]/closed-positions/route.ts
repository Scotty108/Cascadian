/**
 * Polymarket Wallet Closed Positions API
 *
 * Fetches settled/closed positions with realized PnL from Polymarket Data-API
 * Enriches with category data from markets database (from Polymarket's category field)
 * GET /api/polymarket/wallet/[address]/closed-positions?limit=100
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'

// Map Polymarket's category/tag names to our display categories
// Handles both gamma-api categories (lowercase with dashes) and CLOB API tags (Title Case)
function mapPolymarketCategory(polymarketCategory: string | null): string {
  if (!polymarketCategory) return 'Other'

  const categoryMap: Record<string, string> = {
    // CLOB API tags (Title Case)
    'crypto': 'Crypto',
    'sports': 'Sports',
    'politics': 'Politics',
    'economics': 'Economics',
    'business': 'Economics',
    'finance': 'Economics',
    'technology': 'Science & Tech',
    'science': 'Science & Tech',
    'pop culture': 'Pop Culture',
    'entertainment': 'Pop Culture',
    // gamma-api categories (lowercase-with-dashes)
    'cryptocurrency': 'Crypto',
    'us-current-affairs': 'Politics',
    'us-elections': 'Politics',
    'science-tech': 'Science & Tech',
    'pop-culture': 'Pop Culture',
  }

  const normalized = polymarketCategory.toLowerCase()
  return categoryMap[normalized] || 'Other'
}

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
    console.log(`[Closed Positions API] Fetching closed positions for wallet: ${address} (limit: ${limit})`)

    const response = await fetch(
      `https://data-api.polymarket.com/closed-positions?user=${address}&limit=${limit}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Cache closed positions longer - they don't change
        next: { revalidate: 300 }, // 5 minutes
      }
    )

    if (!response.ok) {
      throw new Error(`Data-API error: ${response.status} ${response.statusText}`)
    }

    const closedPositions = await response.json()

    console.log(`[Closed Positions API] Found ${Array.isArray(closedPositions) ? closedPositions.length : 0} closed positions for ${address}`)

    // Enrich with category data - use Polymarket's ACTUAL category field (not keywords!)
    const conditionIds = Array.isArray(closedPositions)
      ? closedPositions.map((pos: any) => pos.conditionId).filter(Boolean)
      : []

    const marketCategories = new Map<string, string>()

    // Step 1: Try database first (for active markets we've synced)
    if (conditionIds.length > 0) {
      const { data: markets } = await supabase
        .from('markets')
        .select('condition_id, category')
        .in('condition_id', conditionIds)

      if (markets) {
        markets.forEach((market: any) => {
          const displayCategory = mapPolymarketCategory(market.category)
          marketCategories.set(market.condition_id, displayCategory)
        })
        console.log(`[Closed Positions API] Found ${marketCategories.size}/${conditionIds.length} markets in database`)
      }
    }

    // Step 2: For missing markets, fetch from Polymarket CLOB API (has tags with category!)
    const missingConditionIds = conditionIds.filter(id => !marketCategories.has(id))
    if (missingConditionIds.length > 0) {
      console.log(`[Closed Positions API] Fetching ${missingConditionIds.length} markets from Polymarket CLOB API...`)

      // Fetch markets individually from CLOB API (supports conditionId lookup for old markets!)
      const fetchPromises = missingConditionIds.map(async (conditionId) => {
        try {
          const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`, {
            next: { revalidate: 3600 } // Cache for 1 hour
          })

          if (response.ok) {
            const market = await response.json()
            // CLOB API returns tags array like ["Sports", "NBA", "Games"]
            // First tag is usually the category
            const categoryTag = market.tags?.[0]
            if (categoryTag) {
              const displayCategory = mapPolymarketCategory(categoryTag)
              marketCategories.set(conditionId, displayCategory)
            }
          }
        } catch (err) {
          console.warn(`[Closed Positions API] Failed to fetch market ${conditionId.slice(0, 10)}:`, err)
        }
      })

      await Promise.all(fetchPromises)
      console.log(`[Closed Positions API] Enriched ${marketCategories.size - (conditionIds.length - missingConditionIds.length)} more from CLOB API`)
    }

    console.log(`[Closed Positions API] Total enriched: ${marketCategories.size}/${conditionIds.length} with real Polymarket categories`)

    // Transform Polymarket API response to match our component's expected format
    const transformedPositions = Array.isArray(closedPositions) ? closedPositions.map((pos: any) => ({
      // Keep original fields
      ...pos,
      // Add transformed fields
      market: pos.title || pos.slug,
      question: pos.title,
      side: pos.outcome || 'N/A',
      entry_price: pos.avgPrice,
      entryPrice: pos.avgPrice,
      exit_price: pos.curPrice,
      exitPrice: pos.curPrice,
      realized_pnl: pos.realizedPnl,
      realizedPnL: pos.realizedPnl,
      profit: pos.realizedPnl,
      closed_at: pos.endDate,
      id: pos.asset || `${pos.proxyWallet}-${pos.conditionId}`,
      position_id: pos.asset,
      // Use category from enrichment (database + Polymarket gamma-api), fallback to 'Other'
      category: marketCategories.get(pos.conditionId) || 'Other',
    })) : []

    return NextResponse.json({
      success: true,
      data: transformedPositions,
      wallet: address,
      count: transformedPositions.length,
      limit: parseInt(limit),
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Closed Positions API] Error for ${address}:`, message)

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
