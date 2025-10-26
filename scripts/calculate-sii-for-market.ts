import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { refreshMarketSII } from '@/lib/metrics/market-sii'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Calculate SII for a specific market by its ID
 *
 * Usage: npx tsx scripts/calculate-sii-for-market.ts 626905
 */

async function main() {
  const marketId = process.argv[2]

  if (!marketId) {
    console.error('❌ Please provide a market ID')
    console.log('Usage: npx tsx scripts/calculate-sii-for-market.ts <marketId>')
    process.exit(1)
  }

  console.log(`🔍 Looking up market ${marketId}...`)

  // Get market from database to find condition_id
  const { data: market, error } = await supabase
    .from('markets')
    .select('*')
    .eq('market_id', marketId)
    .single()

  if (error || !market) {
    console.error(`❌ Market ${marketId} not found in database`)
    console.error('Error:', error?.message)
    process.exit(1)
  }

  const conditionId = market.condition_id
  const marketQuestion = (market as any).question || (market.raw_polymarket_data as any)?.question || 'Unknown'

  if (!conditionId) {
    console.error(`❌ Market ${marketId} has no condition_id`)
    process.exit(1)
  }

  console.log(`✓ Found market: ${marketQuestion}`)
  console.log(`✓ Condition ID: ${conditionId}`)
  console.log()
  console.log('📊 Calculating Smart Money SII...')

  // Calculate SII
  const sii = await refreshMarketSII(conditionId, marketQuestion, true)

  if (!sii) {
    console.error('❌ Could not calculate SII')
    console.error('Possible reasons:')
    console.error('  - No positions found for this market')
    console.error('  - Insufficient wallet Omega scores available')
    process.exit(1)
  }

  console.log()
  console.log('✅ Smart Money SII Calculated!')
  console.log('═'.repeat(60))
  console.log(`Smart Money Side: ${sii.smart_money_side}`)
  console.log(`Signal Strength: ${(sii.signal_strength * 100).toFixed(0)}%`)
  console.log(`Confidence: ${(sii.confidence_score * 100).toFixed(0)}%`)
  console.log()
  console.log(`YES Side:`)
  console.log(`  Average Omega: ${sii.yes_avg_omega.toFixed(2)}`)
  console.log(`  Traders: ${sii.yes_wallet_count}`)
  console.log(`  Volume: $${(sii.yes_total_volume / 1000).toFixed(1)}k`)
  console.log()
  console.log(`NO Side:`)
  console.log(`  Average Omega: ${sii.no_avg_omega.toFixed(2)}`)
  console.log(`  Traders: ${sii.no_wallet_count}`)
  console.log(`  Volume: $${(sii.no_total_volume / 1000).toFixed(1)}k`)
  console.log()
  console.log(`Omega Differential: ${sii.omega_differential >= 0 ? '+' : ''}${sii.omega_differential.toFixed(2)}`)
  console.log('═'.repeat(60))
  console.log()
  console.log('💾 Saved to database. Refresh the page to see it!')
}

main()
