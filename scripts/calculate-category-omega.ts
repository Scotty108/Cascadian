/**
 * Calculate Omega Ratio Per Category
 *
 * Austin's Strategy: Find category specialists
 * - Wallets that are S-grade in AI but F-grade in Sports
 * - Identify "the eggman" in every category
 * - Tag potential insiders (e.g., OpenAI employees)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { pnlClient, resolveTokenId } from '@/lib/goldsky/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

interface CategoryOmegaScore {
  wallet_address: string
  category: string
  omega_ratio: number
  total_pnl: number
  total_gains: number
  total_losses: number
  closed_positions: number
  win_rate: number
  avg_gain: number
  avg_loss: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  roi_per_bet: number
  overall_roi: number
}

/**
 * Fetch markets to get category mapping (condition_id → category)
 * FIXED: Uses condition_id instead of tokenId for better coverage
 * Uses pagination to get ALL markets (Supabase has 1000 row default limit)
 */
async function fetchMarketCategories(): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>()
  let totalMarketsProcessed = 0
  let page = 0
  const pageSize = 1000

  console.log('📊 Fetching markets with pagination (using condition_id)...')

  while (true) {
    const { data: markets, error } = await supabase
      .from('markets')
      .select('condition_id, category')
      .not('category', 'is', null)
      .not('condition_id', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching markets:', error)
      throw error
    }

    if (!markets || markets.length === 0) {
      break // No more markets
    }

    totalMarketsProcessed += markets.length

    markets.forEach((market) => {
      if (market.category && market.condition_id) {
        // Map condition_id → category
        categoryMap.set(market.condition_id.toLowerCase(), market.category)
      }
    })

    console.log(`  Page ${page + 1}: ${markets.length} markets, ${categoryMap.size} total conditions mapped`)

    if (markets.length < pageSize) {
      break // Last page
    }

    page++
  }

  console.log(`📊 Loaded ${categoryMap.size} condition→category mappings from ${totalMarketsProcessed} markets`)
  return categoryMap
}

/**
 * Calculate omega ratio for a wallet in a specific category
 */
function calculateCategoryOmega(
  positions: any[],
  category: string
): CategoryOmegaScore | null {
  const categoryPositions = positions.filter((p) => p.category === category)

  if (categoryPositions.length === 0) {
    return null
  }

  let totalGains = 0
  let totalLosses = 0
  let winCount = 0

  for (const position of categoryPositions) {
    const pnl = parseFloat(position.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

    if (pnl > 0) {
      totalGains += pnl
      winCount++
    } else if (pnl < 0) {
      totalLosses += Math.abs(pnl)
    }
  }

  const omegaRatio = totalLosses === 0 ? (totalGains > 0 ? 100 : 0) : totalGains / totalLosses
  const totalPnl = totalGains - totalLosses
  const winRate = categoryPositions.length > 0 ? winCount / categoryPositions.length : 0
  const avgGain = winCount > 0 ? totalGains / winCount : 0
  const lossCount = categoryPositions.length - winCount
  const avgLoss = lossCount > 0 ? totalLosses / lossCount : 0
  const roiPerBet = categoryPositions.length > 0 ? totalPnl / categoryPositions.length : 0
  const totalCapitalDeployed = totalGains + totalLosses
  const overallRoi = totalCapitalDeployed > 0 ? (totalPnl / totalCapitalDeployed) * 100 : 0

  // Assign grade
  let grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  if (omegaRatio > 3.0) grade = 'S'
  else if (omegaRatio > 2.0) grade = 'A'
  else if (omegaRatio > 1.5) grade = 'B'
  else if (omegaRatio > 1.0) grade = 'C'
  else if (omegaRatio > 0.5) grade = 'D'
  else grade = 'F'

  return {
    wallet_address: '',
    category,
    omega_ratio: omegaRatio,
    total_pnl: totalPnl,
    total_gains: totalGains,
    total_losses: totalLosses,
    closed_positions: categoryPositions.length,
    win_rate: winRate,
    avg_gain: avgGain,
    avg_loss: avgLoss,
    grade,
    roi_per_bet: roiPerBet,
    overall_roi: overallRoi,
  }
}

/**
 * Calculate category-specific omega for a wallet
 */
async function calculateWalletCategoryOmega(
  walletAddress: string,
  categoryMap: Map<string, string>
): Promise<CategoryOmegaScore[]> {
  // Fetch wallet positions
  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
        id
        tokenId
        realizedPnl
      }
    }
  `

  const data: any = await pnlClient.request(query, {
    wallet: walletAddress.toLowerCase(),
  })

  if (!data.userPositions || data.userPositions.length === 0) {
    return []
  }

  // Resolve tokenIds to condition_ids and map to categories
  console.log(`  🔍 Resolving ${data.userPositions.length} tokenIds to conditions...`)

  const positionsWithCategory: any[] = []
  const tokenIdCache = new Map<string, string | null>() // tokenId → condition_id

  for (const position of data.userPositions) {
    // Skip positions with no PnL
    if (parseFloat(position.realizedPnl) === 0) {
      continue
    }

    const tokenId = position.tokenId

    // Check cache first
    let conditionId = tokenIdCache.get(tokenId)

    if (conditionId === undefined) {
      // Not in cache - resolve it
      try {
        const tokenInfo = await resolveTokenId(tokenId)
        conditionId = tokenInfo?.condition?.id?.toLowerCase() || null
        tokenIdCache.set(tokenId, conditionId)

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (error) {
        console.error(`    ⚠️  Failed to resolve ${tokenId}:`, error)
        tokenIdCache.set(tokenId, null)
        conditionId = null
      }
    }

    // Lookup category from condition_id
    if (conditionId) {
      const category = categoryMap.get(conditionId)
      if (category) {
        positionsWithCategory.push({
          ...position,
          category,
          condition_id: conditionId,
        })
      }
    }
  }

  console.log(`  ✅ Resolved ${positionsWithCategory.length}/${data.userPositions.length} positions to categories`)

  // Debug: If low coverage, show sample
  if (positionsWithCategory.length === 0 && data.userPositions.length > 0) {
    const sampleTokenIds = data.userPositions.slice(0, 3).map((p: any) => p.tokenId)
    console.log(`  ⚠️  Sample tokenIds (no matches): ${sampleTokenIds.join(', ')}`)
  }

  // Group by category and calculate omega
  const categoriesSet = new Set(positionsWithCategory.map((p: any) => p.category))
  const categoryScores: CategoryOmegaScore[] = []

  for (const category of categoriesSet) {
    const score = calculateCategoryOmega(positionsWithCategory, category)
    if (score && score.closed_positions >= 5) {
      // Minimum 5 trades per category
      score.wallet_address = walletAddress
      categoryScores.push(score)
    }
  }

  return categoryScores
}

/**
 * Main function: Calculate category omega for top wallets
 */
async function calculateCategoryOmegaForTopWallets() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          CATEGORY-SPECIFIC OMEGA CALCULATION             ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Step 1: Load market categories
  const categoryMap = await fetchMarketCategories()

  if (categoryMap.size === 0) {
    console.log('❌ No market categories found. Ensure markets table has category data.')
    return
  }

  // Step 2: Get top 100 wallets
  const { data: topWallets } = await supabase
    .from('wallet_scores')
    .select('wallet_address, omega_ratio, closed_positions')
    .gte('closed_positions', 10)
    .order('omega_ratio', { ascending: false })
    .limit(100)

  if (!topWallets || topWallets.length === 0) {
    console.log('❌ No top wallets found')
    return
  }

  console.log(`✅ Found ${topWallets.length} top wallets to analyze\n`)

  // Step 3: Calculate category omega for each wallet
  let processed = 0
  let totalCategoryScores = 0

  for (const wallet of topWallets) {
    processed++
    console.log(`[${processed}/${topWallets.length}] Processing ${wallet.wallet_address}...`)

    try {
      const categoryScores = await calculateWalletCategoryOmega(
        wallet.wallet_address,
        categoryMap
      )

      if (categoryScores.length === 0) {
        console.log(`  ⏭️  No category data`)
        continue
      }

      // Save to database
      for (const score of categoryScores) {
        const { error } = await supabase.from('wallet_scores_by_category').upsert(
          {
            wallet_address: score.wallet_address,
            category: score.category,
            omega_ratio: score.omega_ratio,
            total_pnl: score.total_pnl,
            total_gains: score.total_gains,
            total_losses: score.total_losses,
            closed_positions: score.closed_positions,
            win_rate: score.win_rate,
            avg_gain: score.avg_gain,
            avg_loss: score.avg_loss,
            grade: score.grade,
            roi_per_bet: score.roi_per_bet,
            overall_roi: score.overall_roi / 100, // Convert to decimal
            meets_minimum_trades: score.closed_positions >= 5,
            calculated_at: new Date().toISOString(),
          },
          {
            onConflict: 'wallet_address,category',
          }
        )

        if (error) {
          console.log(`  ❌ Error saving ${score.category}: ${error.message}`)
        } else {
          totalCategoryScores++
        }
      }

      // Show wallet's category breakdown
      console.log(`  ✅ Saved ${categoryScores.length} categories:`)
      categoryScores
        .sort((a, b) => b.omega_ratio - a.omega_ratio)
        .forEach((score) => {
          console.log(
            `     [${score.grade}] ${score.category.padEnd(15)} Ω:${score.omega_ratio.toFixed(
              2
            )} | ${score.closed_positions} trades`
          )
        })
    } catch (error) {
      console.log(`  ❌ Error: ${(error as Error).message}`)
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                     SUMMARY                               ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`✅ Processed: ${processed} wallets`)
  console.log(`✅ Total category scores saved: ${totalCategoryScores}`)

  // Find category specialists
  console.log('\n🏆 TOP CATEGORY SPECIALISTS:\n')

  const categories = [
    'Politics',
    'Crypto',
    'Sports',
    'Business',
    'Science',
    'Pop Culture',
  ]

  for (const category of categories) {
    const { data: topInCategory } = await supabase
      .from('wallet_scores_by_category')
      .select('wallet_address, omega_ratio, closed_positions, grade')
      .eq('category', category)
      .eq('meets_minimum_trades', true)
      .order('omega_ratio', { ascending: false })
      .limit(3)

    if (topInCategory && topInCategory.length > 0) {
      console.log(`📊 ${category}:`)
      topInCategory.forEach((w, i) => {
        console.log(
          `   ${i + 1}. [${w.grade}] ${w.wallet_address.slice(
            0,
            12
          )}... Ω:${w.omega_ratio.toFixed(2)} (${w.closed_positions} trades)`
        )
      })
      console.log()
    }
  }

  console.log('✅ Category omega calculation complete!\n')
}

calculateCategoryOmegaForTopWallets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
