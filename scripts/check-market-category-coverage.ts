import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function checkCoverage() {
  console.log('🔍 Checking market category coverage...\n')

  // Count total markets
  const { count: totalCount } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })

  console.log(`📊 Total markets: ${totalCount}`)

  // Count markets with category
  const { count: withCategory } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .not('category', 'is', null)

  console.log(`📊 Markets with category: ${withCategory} (${((withCategory || 0) / (totalCount || 1) * 100).toFixed(1)}%)`)

  // Fetch ALL markets to check clobTokenIds
  const { data: sampleMarkets } = await supabase
    .from('markets')
    .select('market_id, category, raw_polymarket_data')
    .limit(25000) // Get all markets

  const withTokens = sampleMarkets?.filter(m => {
    const tokens = m.raw_polymarket_data?.clobTokenIds
    return tokens && (Array.isArray(tokens) || typeof tokens === 'string')
  }).length || 0

  const withBoth = sampleMarkets?.filter(m => {
    const tokens = m.raw_polymarket_data?.clobTokenIds
    return m.category && tokens && (Array.isArray(tokens) || typeof tokens === 'string')
  }).length || 0

  console.log(`📊 Markets with clobTokenIds (sample of ${sampleMarkets?.length}): ${withTokens}`)
  console.log(`📊 Markets with BOTH category AND clobTokenIds: ${withBoth}\n`)

  // Calculate how many tokens we can map
  let totalTokens = 0
  sampleMarkets?.forEach(m => {
    if (m.category && m.raw_polymarket_data?.clobTokenIds) {
      let tokens = m.raw_polymarket_data.clobTokenIds
      if (typeof tokens === 'string') {
        try {
          tokens = JSON.parse(tokens)
        } catch (e) {
          return
        }
      }
      if (Array.isArray(tokens)) {
        totalTokens += tokens.length
      }
    }
  })

  console.log(`🎯 Total token→category mappings possible: ${totalTokens}`)
  console.log(`📈 Average tokens per market: ${(totalTokens / withBoth).toFixed(1)}\n`)

  // Show sample of markets without categories but with tokens
  const missingCategory = sampleMarkets?.filter(m => {
    const tokens = m.raw_polymarket_data?.clobTokenIds
    return !m.category && tokens && (Array.isArray(tokens) || typeof tokens === 'string')
  }).slice(0, 5)

  if (missingCategory && missingCategory.length > 0) {
    console.log(`⚠️  Sample markets WITH tokens but NO category:`)
    missingCategory.forEach((m, i) => {
      console.log(`  [${i+1}] Market ${m.market_id}: ${m.raw_polymarket_data?.clobTokenIds?.length || '?'} tokens`)
    })
  }
}

checkCoverage().then(() => process.exit(0))
