/**
 * Hook for fetching wallet closed positions from Goldsky PnL Subgraph
 * This gives us COMPLETE data including losses, unlike Polymarket Data-API
 * NOW ENRICHED with market metadata for proper categorization!
 */

import { useQuery } from '@tanstack/react-query'
import { pnlClient } from '@/lib/goldsky/client'
import { createClient } from '@supabase/supabase-js'

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399 // Verified correction factor

// Create Supabase client for market lookups
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Map Polymarket's category names to our display categories
function mapPolymarketCategory(polymarketCategory: string | null): string {
  if (!polymarketCategory) return 'Other'

  const categoryMap: Record<string, string> = {
    'crypto': 'Crypto',
    'cryptocurrency': 'Crypto',
    'sports': 'Sports',
    'politics': 'Politics',
    'us-current-affairs': 'Politics',
    'us-elections': 'Politics',
    'economics': 'Economics',
    'business': 'Economics',
    'finance': 'Economics',
    'science-tech': 'Science & Tech',
    'technology': 'Science & Tech',
    'science': 'Science & Tech',
    'pop-culture': 'Pop Culture',
    'pop culture': 'Pop Culture',
    'entertainment': 'Pop Culture',
  }

  const normalized = polymarketCategory.toLowerCase()
  return categoryMap[normalized] || 'Other'
}

interface GoldskyPosition {
  id: string
  user: string
  tokenId: string
  conditionId?: string
  outcomeIndex?: string
  amount: string
  avgPrice: string
  realizedPnl: string
  totalBought: string
}

export interface WalletClosedPosition {
  id: string
  title: string
  market: string
  slug: string
  category?: string // Category for bubble chart
  realizedPnl: number
  avgPrice: number
  totalBought: number
  invested: number
  roi: number
  tokenId: string
  closed_at: string
}

export interface UseWalletGoldskyPositionsResult {
  positions: WalletClosedPosition[]
  isLoading: boolean
  error: Error | null
  totalPnL: number
  totalPositions: number
}

export function useWalletGoldskyPositions(walletAddress: string): UseWalletGoldskyPositionsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wallet-goldsky-positions', walletAddress],
    queryFn: async () => {
      if (!walletAddress) {
        return []
      }

      try {
        console.log('[Goldsky] Fetching positions for wallet:', walletAddress)

        // Also fetch Polymarket data for category enrichment (winning positions only)
        // NOTE: Polymarket Data-API only returns WINS, not losses!
        let polymarketPositions: any[] = []
        try {
          const pmResponse = await fetch(`/api/polymarket/wallet/${walletAddress}/closed-positions?limit=1000`)
          if (pmResponse.ok) {
            const pmData = await pmResponse.json()
            polymarketPositions = pmData.data || []
            console.log('[Goldsky] Fetched', polymarketPositions.length, 'Polymarket positions (wins only) for enrichment')
          }
        } catch (err) {
          console.warn('[Goldsky] Failed to fetch Polymarket data for enrichment:', err)
        }

        const query = `
          query GetWalletPositionsPnL($wallet: String!) {
            userPositions(where: { user: $wallet }, first: 1000) {
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

        const data = await pnlClient.request<{ userPositions: GoldskyPosition[] }>(query, {
          wallet: walletAddress.toLowerCase(),
        })

        if (!data.userPositions || data.userPositions.length === 0) {
          console.log('[Goldsky] No positions found')
          return []
        }

        // Filter to only closed positions (those with realized PnL)
        const closedPositions = data.userPositions.filter(
          (pos) => parseFloat(pos.realizedPnl) !== 0
        )

        console.log('[Goldsky] Found', closedPositions.length, 'closed positions')

        if (closedPositions.length === 0) {
          return []
        }

        // Build conditionId → category map from Polymarket data (has CLOB enrichment!)
        const conditionIdToCategory = new Map<string, string>()
        polymarketPositions.forEach((pm: any) => {
          if (pm.conditionId && pm.category) {
            conditionIdToCategory.set(pm.conditionId, pm.category)
          }
        })

        console.log('[Goldsky] Built category map with', conditionIdToCategory.size, 'markets')
        console.log('[Goldsky] Sample Polymarket PnL values:', polymarketPositions.slice(0, 3).map((p: any) => p.realizedPnL || p.realized_pnl))

        // Debug raw Goldsky data
        console.log('[Goldsky] Sample raw Goldsky realizedPnl:', closedPositions.slice(0, 3).map(p => p.realizedPnl))
        console.log('[Goldsky] Sample raw Goldsky avgPrice:', closedPositions.slice(0, 3).map(p => p.avgPrice))
        console.log('[Goldsky] Sample raw Goldsky totalBought:', closedPositions.slice(0, 3).map(p => p.totalBought))

        // Match Goldsky positions with Polymarket data to get titles and categories
        // Match by PnL amount (within 10% tolerance)
        let matchCount = 0
        const result = closedPositions.map((pos, index) => {
          // TESTING: Try raw values (no conversion) to see if they match Polymarket
          const rawPnl = parseFloat(pos.realizedPnl)
          const pnlInDollars = rawPnl  // TEST: Use raw value
          const avgPrice = parseFloat(pos.avgPrice)  // TEST: Use raw value
          const totalBought = parseFloat(pos.totalBought)  // TEST: Use raw value
          const invested = avgPrice * totalBought
          const roi = invested > 0 ? pnlInDollars / invested : 0

          // Debug first few positions
          if (index < 5) {
            console.log(`[Goldsky] Position ${index}:`)
            console.log(`  rawPnl=${rawPnl}, pnlInDollars (RAW)=$${pnlInDollars.toFixed(2)}`)
            console.log(`  avgPrice=${avgPrice}, totalBought=${totalBought}, invested=$${invested.toFixed(2)}`)
            console.log(`  roi=${(roi * 100).toFixed(2)}%`)
          }

          // Try to match with Polymarket position by PnL (within tolerance)
          const matchedPM = polymarketPositions.find((pm: any) => {
            const pmPnl = pm.realizedPnL || pm.realized_pnl || 0
            const tolerance = Math.abs(pmPnl * 0.1) // 10% tolerance
            return Math.abs(pmPnl - pnlInDollars) <= tolerance
          })

          if (matchedPM) {
            matchCount++
            if (matchCount <= 3) {
              console.log(`[Goldsky] Matched position ${index}: ${matchedPM.title} (PnL: ${pnlInDollars.toFixed(2)})`)
            }
          }

          const title = matchedPM?.title || matchedPM?.market || `Position ${index + 1}`
          const slug = matchedPM?.slug || ''
          const conditionId = matchedPM?.conditionId

          // Get category from matched position OR from category map
          let category = matchedPM?.category
          if (!category && conditionId) {
            category = conditionIdToCategory.get(conditionId)
          }
          category = category || 'Other'

          return {
            id: `goldsky-${index}-${pos.tokenId.slice(0, 8)}`,
            title,
            market: title,
            slug,
            category, // Include category for bubble chart
            conditionId, // Store for CLOB lookup
            realizedPnl: pnlInDollars,
            avgPrice,
            totalBought,
            invested,
            roi,
            tokenId: pos.tokenId,
            closed_at: new Date().toISOString(),
          }
        })

        console.log(`[Goldsky] PnL matching results: ${matchCount} / ${closedPositions.length} positions matched`)

        // For positions still showing "Other", try database enrichment first
        const unmatchedPositions = result.filter(r => r.category === 'Other')
        if (unmatchedPositions.length > 0) {
          console.log('[Goldsky] Attempting to enrich', unmatchedPositions.length, 'unmatched positions from database...')

          try {
            // Query markets table for ALL markets (we'll match by title later)
            const { data: allMarkets, error } = await supabase
              .from('markets')
              .select('title, slug, category, condition_id')
              .limit(5000)

            if (error) {
              console.warn('[Goldsky] Database query error:', error.message)
            } else if (allMarkets && allMarkets.length > 0) {
              console.log('[Goldsky] Fetched', allMarkets.length, 'markets from database')

              // Build title → market map (lowercase for matching)
              const titleToMarket = new Map<string, { category: string; conditionId: string }>()
              allMarkets.forEach((m: any) => {
                if (m.title && m.category) {
                  const key = m.title.toLowerCase().trim()
                  titleToMarket.set(key, {
                    category: mapPolymarketCategory(m.category),
                    conditionId: m.condition_id
                  })
                }
              })

              // Match unmatched positions by title
              let dbEnrichedCount = 0
              unmatchedPositions.forEach((pos) => {
                if (pos.title && pos.title !== 'Unknown Market' && !pos.title.startsWith('Position ')) {
                  const titleKey = pos.title.toLowerCase().trim()
                  const marketData = titleToMarket.get(titleKey)
                  if (marketData) {
                    pos.category = marketData.category
                    pos.conditionId = marketData.conditionId
                    dbEnrichedCount++
                  }
                }
              })

              console.log('[Goldsky] Database enrichment:', dbEnrichedCount, '/', unmatchedPositions.length, 'positions enriched')
            }
          } catch (err) {
            console.warn('[Goldsky] Failed to fetch from database:', err)
          }
        }

        const enrichedCount = result.filter(r => r.category !== 'Other').length
        console.log('[Goldsky] Successfully transformed', result.length, 'positions')
        console.log('[Goldsky] Enriched', enrichedCount, '/', result.length, 'positions with categories')
        return result
      } catch (err) {
        console.error('[Goldsky] Error fetching positions:', err)
        // Return empty array instead of throwing to prevent UI breakage
        return []
      }
    },
    enabled: !!walletAddress,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1, // Retry once on failure
  })

  const positions = data || []
  const totalPnL = positions.reduce((sum, pos) => sum + pos.realizedPnl, 0)

  return {
    positions,
    isLoading,
    error: error as Error | null,
    totalPnL,
    totalPositions: positions.length,
  }
}
