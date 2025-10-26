/**
 * Austin Methodology - Usage Examples
 *
 * Real-world examples of how to use the Austin Methodology in your application
 */

import {
  analyzeCategories,
  getCategoryAnalysis,
  getWinnableCategories,
  getCategoryRecommendation,
  refreshCategoryAnalytics,
  calculateWinnabilityScore,
  isWinnableGame,
  type CategoryAnalysis,
  type MarketAnalysis,
  type WalletSpecialist,
} from './austin-methodology'

// ============================================================================
// Example 1: Find Best Category to Trade
// ============================================================================

export async function example1_FindBestCategory() {
  console.log('Example 1: Find Best Category\n')

  // Get top 10 categories
  const categories = await analyzeCategories('30d', 10)

  // Get the best one
  const bestCategory = categories[0]

  console.log(`Best Category: ${bestCategory.category}`)
  console.log(`Winnability Score: ${bestCategory.winnabilityScore.toFixed(1)}/100`)
  console.log(`Is Winnable: ${bestCategory.isWinnableGame ? 'YES' : 'NO'}`)
  console.log(`Elite Wallets: ${bestCategory.eliteWalletCount}`)
  console.log(`Median Omega: ${bestCategory.medianOmegaOfElites.toFixed(2)}`)

  return bestCategory
}

// ============================================================================
// Example 2: Get Winnable Categories Only
// ============================================================================

export async function example2_WinnableOnly() {
  console.log('Example 2: Winnable Categories Only\n')

  // Filter to only winnable categories
  const winnableCategories = await getWinnableCategories('30d', 20)

  console.log(`Found ${winnableCategories.length} winnable categories:`)
  winnableCategories.forEach((cat) => {
    console.log(`- ${cat.category} (${cat.winnabilityScore.toFixed(1)}/100)`)
  })

  return winnableCategories
}

// ============================================================================
// Example 3: Deep Dive into Specific Category
// ============================================================================

export async function example3_DeepDive(category: string = 'Politics') {
  console.log(`Example 3: Deep Dive into ${category}\n`)

  // Get full analysis with markets and specialists
  const analysis = await getCategoryAnalysis(category, '30d', true, true)

  if (!analysis) {
    console.log(`Category ${category} not found`)
    return null
  }

  console.log(`Category: ${analysis.category}`)
  console.log(`Winnability Score: ${analysis.winnabilityScore.toFixed(1)}/100`)
  console.log(`Is Winnable: ${analysis.isWinnableGame ? 'YES' : 'NO'}`)
  console.log('')

  // Top markets
  console.log('Top 3 Markets:')
  analysis.topMarkets.slice(0, 3).forEach((market, i) => {
    console.log(`${i + 1}. ${market.question}`)
    console.log(`   Volume: $${market.volume24h.toLocaleString()}`)
    console.log(`   Elite Participation: ${(market.eliteParticipation * 100).toFixed(1)}%`)
    console.log(`   Avg Elite Omega: ${market.avgEliteOmega.toFixed(2)}`)
  })
  console.log('')

  // Top specialists
  console.log('Top 5 Specialists:')
  analysis.topSpecialists.slice(0, 5).forEach((specialist, i) => {
    console.log(`${i + 1}. ${specialist.walletAddress.substring(0, 10)}...`)
    console.log(`   Category Omega: ${specialist.categoryOmega.toFixed(2)}`)
    console.log(`   Trades: ${specialist.tradesInCategory}`)
    console.log(`   % of Wallet: ${(specialist.pctOfWalletTrades * 100).toFixed(1)}%`)
    console.log(`   Insider: ${specialist.isInsider ? 'YES' : 'No'}`)
  })

  return analysis
}

// ============================================================================
// Example 4: Get Personalized Recommendation
// ============================================================================

export async function example4_PersonalizedRecommendation(
  preferredCategories?: string[]
) {
  console.log('Example 4: Personalized Recommendation\n')

  const recommendation = await getCategoryRecommendation(preferredCategories)

  if (!recommendation) {
    console.log('No recommendation available')
    return null
  }

  console.log(`Recommended Category: ${recommendation.category}`)
  console.log(`Winnability Score: ${recommendation.winnabilityScore.toFixed(1)}/100`)
  console.log(`Elite Wallets: ${recommendation.eliteWalletCount}`)
  console.log(`Median Omega: ${recommendation.medianOmegaOfElites.toFixed(2)}`)

  return recommendation
}

// ============================================================================
// Example 5: Filter High-Quality Markets
// ============================================================================

export async function example5_FilterHighQualityMarkets(category: string) {
  console.log(`Example 5: High-Quality Markets in ${category}\n`)

  const analysis = await getCategoryAnalysis(category, '30d', true, false)

  if (!analysis) return []

  // Filter for high-quality markets
  const highQualityMarkets = analysis.topMarkets.filter(
    (market) =>
      market.eliteParticipation > 0.3 && // >30% elite participation
      market.avgEliteOmega > 2.5 && // High omega traders
      market.liquidity > 10000 // Liquid enough
  )

  console.log(`Found ${highQualityMarkets.length} high-quality markets:`)
  highQualityMarkets.forEach((market) => {
    console.log(`- ${market.question.substring(0, 60)}...`)
    console.log(`  Elite: ${(market.eliteParticipation * 100).toFixed(1)}%`)
    console.log(`  Omega: ${market.avgEliteOmega.toFixed(2)}`)
  })

  return highQualityMarkets
}

// ============================================================================
// Example 6: Find Category Specialists
// ============================================================================

export async function example6_FindSpecialists(category: string) {
  console.log(`Example 6: Finding Specialists in ${category}\n`)

  const analysis = await getCategoryAnalysis(category, '30d', false, true)

  if (!analysis) return []

  // Filter for true specialists (>50% of their trades in this category)
  const specialists = analysis.topSpecialists.filter(
    (s) => s.pctOfWalletTrades > 0.5 && s.categoryOmega > 2.0
  )

  console.log(`Found ${specialists.length} true specialists:`)
  specialists.forEach((specialist) => {
    console.log(`- ${specialist.walletAddress}`)
    console.log(`  Omega: ${specialist.categoryOmega.toFixed(2)}`)
    console.log(`  Trades: ${specialist.tradesInCategory}`)
    console.log(`  Focus: ${(specialist.pctOfWalletTrades * 100).toFixed(1)}%`)
  })

  return specialists
}

// ============================================================================
// Example 7: Compare Multiple Categories
// ============================================================================

export async function example7_CompareCategories(
  categories: string[] = ['Politics', 'Crypto', 'Sports']
) {
  console.log('Example 7: Compare Categories\n')

  const analyses = await Promise.all(
    categories.map((cat) => getCategoryAnalysis(cat, '30d', false, false))
  )

  console.log('Category Comparison:\n')
  console.log('Category'.padEnd(15), 'Score', 'Elites', 'Omega', 'Winnable')
  console.log('-'.repeat(60))

  analyses.forEach((analysis) => {
    if (!analysis) return

    console.log(
      analysis.category.padEnd(15),
      analysis.winnabilityScore.toFixed(1).padStart(5),
      analysis.eliteWalletCount.toString().padStart(7),
      analysis.medianOmegaOfElites.toFixed(2).padStart(6),
      (analysis.isWinnableGame ? 'YES' : 'NO').padStart(8)
    )
  })

  return analyses.filter((a) => a !== null)
}

// ============================================================================
// Example 8: Track Winnability Over Time
// ============================================================================

export async function example8_WinnabilityOverTime(category: string) {
  console.log(`Example 8: Winnability Over Time for ${category}\n`)

  // Get analysis for different time windows
  const windows = ['24h', '7d', '30d'] as const
  const analyses = await Promise.all(
    windows.map((window) => getCategoryAnalysis(category, window, false, false))
  )

  console.log('Time Window Analysis:\n')
  console.log('Window', 'Score', 'Elites', 'Omega', 'Winnable')
  console.log('-'.repeat(60))

  windows.forEach((window, i) => {
    const analysis = analyses[i]
    if (!analysis) return

    console.log(
      window.padEnd(7),
      analysis.winnabilityScore.toFixed(1).padStart(5),
      analysis.eliteWalletCount.toString().padStart(7),
      analysis.medianOmegaOfElites.toFixed(2).padStart(6),
      (analysis.isWinnableGame ? 'YES' : 'NO').padStart(8)
    )
  })

  return analyses.filter((a) => a !== null)
}

// ============================================================================
// Example 9: Build Trading Strategy
// ============================================================================

export async function example9_BuildStrategy() {
  console.log('Example 9: Building a Trading Strategy\n')

  // Step 1: Find winnable categories
  const winnableCategories = await getWinnableCategories('30d', 5)
  console.log(`Step 1: Found ${winnableCategories.length} winnable categories`)

  if (winnableCategories.length === 0) {
    console.log('No winnable categories found')
    return null
  }

  // Step 2: Pick the best one
  const bestCategory = winnableCategories[0]
  console.log(`Step 2: Selected ${bestCategory.category}`)

  // Step 3: Get detailed analysis
  const analysis = await getCategoryAnalysis(bestCategory.category, '30d', true, true)
  if (!analysis) return null

  console.log(`Step 3: Analyzed ${analysis.topMarkets.length} markets`)

  // Step 4: Filter high-quality markets
  const goodMarkets = analysis.topMarkets.filter(
    (m) => m.eliteParticipation > 0.3 && m.avgEliteOmega > 2.5
  )
  console.log(`Step 4: Found ${goodMarkets.length} high-quality markets`)

  // Step 5: Get specialists to follow
  const specialists = analysis.topSpecialists
    .filter((s) => s.categoryOmega > 3.0)
    .slice(0, 10)
  console.log(`Step 5: Identified ${specialists.length} elite specialists`)

  console.log('\nTrading Strategy:')
  console.log(`- Trade in: ${bestCategory.category}`)
  console.log(`- Focus on ${goodMarkets.length} high-quality markets`)
  console.log(`- Follow ${specialists.length} elite wallets`)

  return {
    category: bestCategory,
    markets: goodMarkets,
    specialists,
  }
}

// ============================================================================
// Example 10: Refresh Analytics (Cron Job)
// ============================================================================

export async function example10_RefreshAnalytics() {
  console.log('Example 10: Refreshing Analytics\n')

  const windows = ['24h', '7d', '30d', 'lifetime'] as const

  for (const window of windows) {
    console.log(`Refreshing ${window}...`)
    const start = Date.now()

    try {
      await refreshCategoryAnalytics(window)
      const duration = Date.now() - start
      console.log(`✅ ${window} refreshed in ${duration}ms`)
    } catch (error) {
      console.error(`❌ ${window} failed:`, error)
    }
  }

  console.log('\nRefresh complete!')
}

// ============================================================================
// Run All Examples
// ============================================================================

export async function runAllExamples() {
  console.log('='.repeat(70))
  console.log('Austin Methodology - Usage Examples')
  console.log('='.repeat(70))
  console.log('')

  try {
    await example1_FindBestCategory()
    console.log('\n' + '-'.repeat(70) + '\n')

    await example2_WinnableOnly()
    console.log('\n' + '-'.repeat(70) + '\n')

    await example3_DeepDive('Politics')
    console.log('\n' + '-'.repeat(70) + '\n')

    await example4_PersonalizedRecommendation(['Politics', 'Crypto'])
    console.log('\n' + '-'.repeat(70) + '\n')

    await example5_FilterHighQualityMarkets('Politics')
    console.log('\n' + '-'.repeat(70) + '\n')

    await example6_FindSpecialists('Politics')
    console.log('\n' + '-'.repeat(70) + '\n')

    await example7_CompareCategories(['Politics', 'Crypto', 'Sports'])
    console.log('\n' + '-'.repeat(70) + '\n')

    await example8_WinnabilityOverTime('Politics')
    console.log('\n' + '-'.repeat(70) + '\n')

    await example9_BuildStrategy()
    console.log('\n' + '-'.repeat(70) + '\n')

    console.log('\n✅ All examples completed successfully!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error)
}
