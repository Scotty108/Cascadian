/**
 * Test Script: Austin Methodology
 *
 * Tests all functionality of the Austin Methodology analyzer
 */

import {
  analyzeCategories,
  getCategoryAnalysis,
  getWinnableCategories,
  getCategoryRecommendation,
  refreshCategoryAnalytics,
  calculateWinnabilityScore,
  isWinnableGame,
  WINNABILITY_THRESHOLDS,
  WINNABILITY_WEIGHTS,
  type CategoryAnalysis,
} from '@/lib/metrics/austin-methodology'

async function main() {
  console.log('🎯 Testing Austin Methodology Analyzer\n')
  console.log('=' .repeat(60))

  // ============================================================================
  // Test 1: Refresh Analytics
  // ============================================================================
  console.log('\n📊 Test 1: Refreshing Category Analytics...')
  try {
    console.log('   Refreshing 30d window...')
    await refreshCategoryAnalytics('30d')
    console.log('   ✅ Analytics refreshed successfully')
  } catch (error) {
    console.error('   ❌ Failed to refresh analytics:', error)
  }

  // ============================================================================
  // Test 2: Analyze All Categories
  // ============================================================================
  console.log('\n📊 Test 2: Analyzing All Categories...')
  try {
    const categories = await analyzeCategories('30d', 10)
    console.log(`   ✅ Found ${categories.length} categories`)

    if (categories.length > 0) {
      console.log('\n   Top 5 Categories by Winnability:')
      categories.slice(0, 5).forEach((cat, index) => {
        console.log(`   ${index + 1}. ${cat.category}`)
        console.log(`      - Rank: #${cat.categoryRank}`)
        console.log(`      - Elite Wallets: ${cat.eliteWalletCount}`)
        console.log(`      - Median Omega: ${cat.medianOmegaOfElites.toFixed(2)}`)
        console.log(`      - Mean CLV: ${cat.meanCLVOfElites.toFixed(4)}`)
        console.log(`      - Avg EV/Hour: $${cat.avgEVPerHour.toFixed(2)}`)
        console.log(`      - Total Volume: $${cat.totalVolumeUsd.toLocaleString()}`)
        console.log(`      - Winnability Score: ${cat.winnabilityScore.toFixed(1)}/100`)
        console.log(`      - Is Winnable: ${cat.isWinnableGame ? '✅ YES' : '❌ NO'}`)
        console.log('')
      })
    }
  } catch (error) {
    console.error('   ❌ Failed to analyze categories:', error)
  }

  // ============================================================================
  // Test 3: Get Winnable Categories Only
  // ============================================================================
  console.log('\n📊 Test 3: Finding Winnable Categories...')
  try {
    const winnableCategories = await getWinnableCategories('30d', 20)
    console.log(`   ✅ Found ${winnableCategories.length} winnable categories`)

    if (winnableCategories.length > 0) {
      console.log('\n   Winnable Categories:')
      winnableCategories.forEach((cat) => {
        console.log(`   - ${cat.category} (Score: ${cat.winnabilityScore.toFixed(1)}/100)`)
      })
    } else {
      console.log('   ⚠️  No categories meet winnability criteria:')
      console.log(`      - Min Elite Wallets: ${WINNABILITY_THRESHOLDS.MIN_ELITE_WALLETS}`)
      console.log(`      - Min Median Omega: ${WINNABILITY_THRESHOLDS.MIN_MEDIAN_OMEGA}`)
      console.log(`      - Min Mean CLV: ${WINNABILITY_THRESHOLDS.MIN_MEAN_CLV}`)
      console.log(`      - Min EV/Hour: $${WINNABILITY_THRESHOLDS.MIN_AVG_EV_PER_HOUR}`)
      console.log(`      - Min Volume: $${WINNABILITY_THRESHOLDS.MIN_TOTAL_VOLUME.toLocaleString()}`)
    }
  } catch (error) {
    console.error('   ❌ Failed to get winnable categories:', error)
  }

  // ============================================================================
  // Test 4: Deep Dive into Specific Category
  // ============================================================================
  console.log('\n📊 Test 4: Deep Dive into Specific Category...')
  try {
    const categories = await analyzeCategories('30d', 1)
    if (categories.length > 0) {
      const topCategory = categories[0].category
      console.log(`   Analyzing: ${topCategory}`)

      const analysis = await getCategoryAnalysis(topCategory, '30d', true, true)

      if (analysis) {
        console.log(`   ✅ Category Analysis Complete`)
        console.log('\n   Metrics:')
        console.log(`      - Elite Wallets: ${analysis.eliteWalletCount}`)
        console.log(`      - Median Omega: ${analysis.medianOmegaOfElites.toFixed(2)}`)
        console.log(`      - Mean CLV: ${analysis.meanCLVOfElites.toFixed(4)}`)
        console.log(`      - Avg EV/Hour: $${analysis.avgEVPerHour.toFixed(2)}`)
        console.log(`      - Total Volume: $${analysis.totalVolumeUsd.toLocaleString()}`)
        console.log(`      - Active Markets: ${analysis.activeMarketCount}`)

        if (analysis.topMarkets.length > 0) {
          console.log('\n   Top Markets:')
          analysis.topMarkets.slice(0, 3).forEach((market, i) => {
            console.log(`   ${i + 1}. ${market.question.substring(0, 60)}...`)
            console.log(`      - Volume 24h: $${market.volume24h.toLocaleString()}`)
            console.log(`      - Elite Participation: ${(market.eliteParticipation * 100).toFixed(1)}%`)
            console.log(`      - Avg Elite Omega: ${market.avgEliteOmega.toFixed(2)}`)
          })
        }

        if (analysis.topSpecialists.length > 0) {
          console.log('\n   Top Specialists:')
          analysis.topSpecialists.slice(0, 5).forEach((specialist, i) => {
            console.log(`   ${i + 1}. ${specialist.walletAddress.substring(0, 10)}...`)
            console.log(`      - Category Omega: ${specialist.categoryOmega.toFixed(2)}`)
            console.log(`      - Trades: ${specialist.tradesInCategory}`)
            console.log(`      - % of Wallet: ${(specialist.pctOfWalletTrades * 100).toFixed(1)}%`)
            console.log(`      - Insider: ${specialist.isInsider ? '🚨 YES' : 'No'}`)
          })
        }
      }
    }
  } catch (error) {
    console.error('   ❌ Failed to analyze specific category:', error)
  }

  // ============================================================================
  // Test 5: Get Category Recommendation
  // ============================================================================
  console.log('\n📊 Test 5: Getting Category Recommendation...')
  try {
    const recommendation = await getCategoryRecommendation()

    if (recommendation) {
      console.log(`   ✅ Recommended Category: ${recommendation.category}`)
      console.log(`      - Winnability Score: ${recommendation.winnabilityScore.toFixed(1)}/100`)
      console.log(`      - Elite Wallets: ${recommendation.eliteWalletCount}`)
      console.log(`      - Median Omega: ${recommendation.medianOmegaOfElites.toFixed(2)}`)
      console.log(`      - Mean CLV: ${recommendation.meanCLVOfElites.toFixed(4)}`)
    } else {
      console.log('   ⚠️  No recommendation available')
    }
  } catch (error) {
    console.error('   ❌ Failed to get recommendation:', error)
  }

  // ============================================================================
  // Test 6: Test Winnability Calculation
  // ============================================================================
  console.log('\n📊 Test 6: Testing Winnability Calculation...')

  const testAnalysis: CategoryAnalysis = {
    category: 'Test Category',
    categoryRank: 1,
    eliteWalletCount: 50,
    medianOmegaOfElites: 3.0,
    meanCLVOfElites: 0.03,
    avgEVPerHour: 15,
    totalVolumeUsd: 500000,
    avgMarketLiquidity: 100000,
    activeMarketCount: 20,
    topMarkets: [],
    topSpecialists: [],
    isWinnableGame: false,
    winnabilityScore: 0,
    calculatedAt: new Date(),
  }

  const score = calculateWinnabilityScore(testAnalysis)
  const winnable = isWinnableGame(testAnalysis)

  console.log('   Test Analysis:')
  console.log(`      - Elite Wallets: ${testAnalysis.eliteWalletCount}`)
  console.log(`      - Median Omega: ${testAnalysis.medianOmegaOfElites}`)
  console.log(`      - Mean CLV: ${testAnalysis.meanCLVOfElites}`)
  console.log(`      - Avg EV/Hour: $${testAnalysis.avgEVPerHour}`)
  console.log(`      - Total Volume: $${testAnalysis.totalVolumeUsd.toLocaleString()}`)
  console.log(`   Winnability Score: ${score.toFixed(1)}/100`)
  console.log(`   Is Winnable Game: ${winnable ? '✅ YES' : '❌ NO'}`)

  // ============================================================================
  // Test 7: Cache Performance
  // ============================================================================
  console.log('\n📊 Test 7: Testing Cache Performance...')
  try {
    console.log('   First call (no cache)...')
    const start1 = Date.now()
    await analyzeCategories('30d', 5)
    const duration1 = Date.now() - start1
    console.log(`   ✅ Duration: ${duration1}ms`)

    console.log('   Second call (with cache)...')
    const start2 = Date.now()
    await analyzeCategories('30d', 5)
    const duration2 = Date.now() - start2
    console.log(`   ✅ Duration: ${duration2}ms`)

    const speedup = ((duration1 - duration2) / duration1 * 100).toFixed(1)
    console.log(`   🚀 Cache speedup: ${speedup}%`)
  } catch (error) {
    console.error('   ❌ Failed cache test:', error)
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n' + '='.repeat(60))
  console.log('✅ Austin Methodology Tests Complete!')
  console.log('\nWinnability Thresholds:')
  console.log(`   - Min Elite Wallets: ${WINNABILITY_THRESHOLDS.MIN_ELITE_WALLETS}`)
  console.log(`   - Min Median Omega: ${WINNABILITY_THRESHOLDS.MIN_MEDIAN_OMEGA}`)
  console.log(`   - Min Mean CLV: ${WINNABILITY_THRESHOLDS.MIN_MEAN_CLV}`)
  console.log(`   - Min EV/Hour: $${WINNABILITY_THRESHOLDS.MIN_AVG_EV_PER_HOUR}`)
  console.log(`   - Min Volume: $${WINNABILITY_THRESHOLDS.MIN_TOTAL_VOLUME.toLocaleString()}`)

  console.log('\nWinnability Score Weights:')
  console.log(`   - Elite Count: ${WINNABILITY_WEIGHTS.ELITE_COUNT_POINTS} points (max ${WINNABILITY_WEIGHTS.ELITE_COUNT_MAX})`)
  console.log(`   - Median Omega: ${WINNABILITY_WEIGHTS.MEDIAN_OMEGA_POINTS} points (max ${WINNABILITY_WEIGHTS.MEDIAN_OMEGA_MAX})`)
  console.log(`   - Mean CLV: ${WINNABILITY_WEIGHTS.MEAN_CLV_POINTS} points (max ${WINNABILITY_WEIGHTS.MEAN_CLV_MAX})`)
  console.log(`   - EV/Hour: ${WINNABILITY_WEIGHTS.EV_PER_HOUR_POINTS} points (max ${WINNABILITY_WEIGHTS.EV_PER_HOUR_MAX})`)
  console.log(`   - Volume: ${WINNABILITY_WEIGHTS.TOTAL_VOLUME_POINTS} points (max $${WINNABILITY_WEIGHTS.TOTAL_VOLUME_MAX.toLocaleString()})`)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
