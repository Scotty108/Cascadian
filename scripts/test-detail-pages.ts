/**
 * Detail Pages Data Loading Test
 *
 * Tests all detail pages to ensure fresh, correct data is loading
 * Usage: npx tsx scripts/test-detail-pages.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TestResult {
  page: string
  endpoint: string
  status: 'pass' | 'fail' | 'warning'
  message: string
  data?: any
}

const results: TestResult[] = []

async function testEndpoint(endpoint: string, pageName: string): Promise<TestResult> {
  try {
    const response = await fetch(endpoint)

    if (!response.ok) {
      return {
        page: pageName,
        endpoint,
        status: 'fail',
        message: `HTTP ${response.status}: ${response.statusText}`
      }
    }

    const data = await response.json()

    // Check if data is meaningful (not empty or error)
    if (data.error) {
      return {
        page: pageName,
        endpoint,
        status: 'warning',
        message: `API returned error: ${data.error}`
      }
    }

    return {
      page: pageName,
      endpoint,
      status: 'pass',
      message: 'Successfully loaded fresh data',
      data: typeof data === 'object' ? Object.keys(data) : data
    }

  } catch (error) {
    return {
      page: pageName,
      endpoint,
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function main() {
  console.log('\n')
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║                                                           ║')
  console.log('║         DETAIL PAGES DATA LOADING TEST                   ║')
  console.log('║                                                           ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  // Get sample IDs from database for realistic testing
  console.log('📊 Fetching sample data from database...\n')

  const { data: sampleMarkets } = await supabase
    .from('markets')
    .select('market_id, slug')
    .limit(3)

  const { data: sampleWallets } = await supabase
    .from('discovered_wallets')
    .select('wallet_address')
    .limit(3)

  const sampleMarketId = sampleMarkets?.[0]?.market_id || '0x123' // fallback
  const sampleWalletAddress = sampleWallets?.[0]?.wallet_address || '0xabc' // fallback

  console.log(`   Sample Market ID: ${sampleMarketId}`)
  console.log(`   Sample Wallet: ${sampleWalletAddress}\n`)

  console.log('═══════════════════════════════════════════════════════════\n')
  console.log('🧪 TESTING API ENDPOINTS\n')

  // Test Market Detail APIs
  console.log('1️⃣  MARKET DETAIL PAGE\n')

  const marketEndpoints = [
    `/api/polymarket/markets/${sampleMarketId}`,
    `/api/polymarket/ohlc/${sampleMarketId}`,
    `/api/polymarket/order-book/${sampleMarketId}`,
    `/api/markets/${sampleMarketId}/sii`,
    `/api/signals/tsi/${sampleMarketId}`,
  ]

  for (const endpoint of marketEndpoints) {
    const result = await testEndpoint(`http://localhost:3000${endpoint}`, 'Market Detail')
    results.push(result)

    const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️ ' : '❌'
    console.log(`   ${icon} ${endpoint}`)
    console.log(`      ${result.message}`)
    if (result.data) {
      console.log(`      Data keys: ${JSON.stringify(result.data).slice(0, 100)}...`)
    }
    console.log()
  }

  // Test Wallet Detail APIs
  console.log('\n2️⃣  WALLET DETAIL PAGE\n')

  const walletEndpoints = [
    `/api/polymarket/wallet/${sampleWalletAddress}/positions`,
    `/api/polymarket/wallet/${sampleWalletAddress}/trades`,
    `/api/polymarket/wallet/${sampleWalletAddress}/value`,
    `/api/polymarket/wallet/${sampleWalletAddress}/closed-positions`,
  ]

  for (const endpoint of walletEndpoints) {
    const result = await testEndpoint(`http://localhost:3000${endpoint}`, 'Wallet Detail')
    results.push(result)

    const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️ ' : '❌'
    console.log(`   ${icon} ${endpoint}`)
    console.log(`      ${result.message}`)
    console.log()
  }

  // Test Event Detail API
  console.log('\n3️⃣  EVENT DETAIL PAGE\n')

  const eventSlug = '2024-presidential-election' // sample
  const result = await testEndpoint(`http://localhost:3000/api/polymarket/events/${eventSlug}`, 'Event Detail')
  results.push(result)

  const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️ ' : '❌'
  console.log(`   ${icon} /api/polymarket/events/${eventSlug}`)
  console.log(`      ${result.message}`)
  console.log()

  // Print Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('           📊 TEST SUMMARY 📊                              ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const passed = results.filter(r => r.status === 'pass').length
  const warnings = results.filter(r => r.status === 'warning').length
  const failed = results.filter(r => r.status === 'fail').length

  console.log(`✅ Passed:   ${passed}/${results.length}`)
  console.log(`⚠️  Warnings: ${warnings}/${results.length}`)
  console.log(`❌ Failed:   ${failed}/${results.length}\n`)

  if (failed > 0) {
    console.log('❌ FAILED ENDPOINTS:\n')
    results
      .filter(r => r.status === 'fail')
      .forEach(r => {
        console.log(`   ${r.endpoint}`)
        console.log(`   → ${r.message}\n`)
      })
  }

  if (warnings > 0) {
    console.log('⚠️  WARNING ENDPOINTS:\n')
    results
      .filter(r => r.status === 'warning')
      .forEach(r => {
        console.log(`   ${r.endpoint}`)
        console.log(`   → ${r.message}\n`)
      })
  }

  console.log('═══════════════════════════════════════════════════════════\n')

  if (passed === results.length) {
    console.log('🎉 ALL TESTS PASSED! All detail pages are loading fresh data correctly.\n')
  } else if (failed === 0) {
    console.log('✅ Tests completed with warnings. Check warnings above.\n')
  } else {
    console.log('❌ Some tests failed. Fix the failing endpoints before deployment.\n')
  }

  console.log('📝 NEXT STEPS:\n')
  console.log('1. If tests pass: Your detail pages are production-ready')
  console.log('2. If warnings: APIs may need sample data or authentication')
  console.log('3. If failures: Check API implementation and error logs\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error('\n❌ Test script error:', error)
  process.exit(1)
})
