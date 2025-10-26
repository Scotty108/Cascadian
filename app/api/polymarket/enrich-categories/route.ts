/**
 * Category Enrichment API
 *
 * Server-side endpoint to enrich market titles OR tokenIds with categories
 * Builds tokenId → market map from gamma-api + CLOB API
 * Avoids CORS issues by running on server
 *
 * POST /api/polymarket/enrich-categories
 * Body: { titles?: string[], tokenIds?: string[] }
 * Returns: {
 *   titleCategories?: Record<string, string>,
 *   tokenData?: Record<string, { title: string, category: string, conditionId: string }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server'

// In-memory cache for tokenId → market map (1 hour TTL)
let tokenMapCache: {
  map: Map<string, { title: string, category: string, conditionId: string }>,
  timestamp: number
} | null = null

const CACHE_TTL = 3600000 // 1 hour in ms

// Map Polymarket's category/tag names to our display categories
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

// Build tokenId → market map from gamma-api + CLOB
async function buildTokenMap(): Promise<Map<string, { title: string, category: string, conditionId: string }>> {
  console.log('[Token Map] Building tokenId → market map...')

  const tokenMap = new Map<string, { title: string, category: string, conditionId: string }>()

  // Fetch markets from gamma-api (has categories and conditionIds)
  const gammaResponse = await fetch('https://gamma-api.polymarket.com/markets?limit=1000&closed=true')
  if (!gammaResponse.ok) {
    throw new Error(`Gamma API error: ${gammaResponse.status}`)
  }

  const markets = await gammaResponse.json()
  console.log(`[Token Map] Fetched ${markets.length} markets from gamma-api`)

  // For each market, fetch token data from CLOB API (batch in groups of 10)
  const BATCH_SIZE = 10
  let processedCount = 0
  let tokenCount = 0

  for (let i = 0; i < Math.min(markets.length, 200); i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (market: any) => {
      if (!market.conditionId || !market.category) return

      try {
        const clobResponse = await fetch(`https://clob.polymarket.com/markets/${market.conditionId}`)
        if (clobResponse.ok) {
          const clobData = await clobResponse.json()

          if (clobData.tokens && Array.isArray(clobData.tokens)) {
            clobData.tokens.forEach((token: any) => {
              if (token.token_id) {
                tokenMap.set(token.token_id, {
                  title: market.question || clobData.question || 'Unknown Market',
                  category: mapPolymarketCategory(market.category),
                  conditionId: market.conditionId
                })
                tokenCount++
              }
            })
          }
        }
      } catch (err) {
        // Silently skip failed markets
      }
    }))

    processedCount += batch.length
    if (processedCount % 50 === 0) {
      console.log(`[Token Map] Processed ${processedCount}/${Math.min(markets.length, 200)} markets, ${tokenCount} tokens mapped`)
    }
  }

  console.log(`[Token Map] Built map with ${tokenCount} tokens from ${processedCount} markets`)
  return tokenMap
}

export async function POST(request: NextRequest) {
  try {
    const { titles, tokenIds } = await request.json()

    // Handle tokenId enrichment
    if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      console.log(`[Category Enrichment] Enriching ${tokenIds.length} tokenIds...`)
      console.log('[Category Enrichment] Sample requested tokenIds:', tokenIds.slice(0, 5))

      // Check cache
      const now = Date.now()
      if (!tokenMapCache || (now - tokenMapCache.timestamp) > CACHE_TTL) {
        console.log('[Category Enrichment] Cache miss, building new tokenId map...')
        const map = await buildTokenMap()
        tokenMapCache = { map, timestamp: now }
        console.log('[Category Enrichment] Built map with', map.size, 'tokenIds')

        // Debug: Show sample tokenIds from map
        const sampleKeys = Array.from(map.keys()).slice(0, 5)
        console.log('[Category Enrichment] Sample tokenIds in map:', sampleKeys)
      } else {
        console.log('[Category Enrichment] Using cached tokenId map with', tokenMapCache.map.size, 'entries')
        const sampleKeys = Array.from(tokenMapCache.map.keys()).slice(0, 5)
        console.log('[Category Enrichment] Sample tokenIds in cache:', sampleKeys)
      }

      // Resolve tokenIds
      const tokenData: Record<string, { title: string, category: string, conditionId: string }> = {}
      let enrichedCount = 0

      tokenIds.forEach((tokenId: string) => {
        const marketData = tokenMapCache!.map.get(tokenId)
        if (marketData) {
          tokenData[tokenId] = marketData
          enrichedCount++
        }
      })

      console.log(`[Category Enrichment] Enriched ${enrichedCount}/${tokenIds.length} tokenIds`)

      // Debug: If no matches, show why
      if (enrichedCount === 0 && tokenIds.length > 0) {
        console.log('[Category Enrichment] DEBUG: No matches found!')
        console.log('[Category Enrichment] First requested tokenId:', tokenIds[0])
        console.log('[Category Enrichment] First map tokenId:', Array.from(tokenMapCache!.map.keys())[0])
        console.log('[Category Enrichment] Are they equal?', tokenIds[0] === Array.from(tokenMapCache!.map.keys())[0])
      }

      return NextResponse.json({
        success: true,
        tokenData,
        enrichedCount,
        totalCount: tokenIds.length
      })
    }

    // Handle title enrichment (original functionality)
    if (titles && Array.isArray(titles) && titles.length > 0) {
      console.log(`[Category Enrichment] Enriching ${titles.length} market titles...`)

      const gammaResponse = await fetch('https://gamma-api.polymarket.com/markets?limit=2000&closed=true', {
        next: { revalidate: 3600 }
      })

      if (!gammaResponse.ok) {
        throw new Error(`Gamma API error: ${gammaResponse.status}`)
      }

      const allMarkets = await gammaResponse.json()
      console.log(`[Category Enrichment] Fetched ${allMarkets.length} markets from gamma-api`)

      const categories: Record<string, string> = {}

      titles.forEach((title: string) => {
        const titleLower = title.toLowerCase().trim()
        const market = allMarkets.find((m: any) => {
          const marketTitle = (m.question || '').toLowerCase().trim()
          return marketTitle === titleLower ||
                 marketTitle.includes(titleLower) ||
                 titleLower.includes(marketTitle)
        })

        categories[title] = market && market.category ? mapPolymarketCategory(market.category) : 'Other'
      })

      const enrichedCount = Object.values(categories).filter(c => c !== 'Other').length
      console.log(`[Category Enrichment] Enriched ${enrichedCount}/${titles.length} titles with categories`)

      return NextResponse.json({
        success: true,
        categories,
        enrichedCount,
        totalCount: titles.length
      })
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request: titles or tokenIds array required' },
      { status: 400 }
    )

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Category Enrichment] Error:', message)

    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    )
  }
}
