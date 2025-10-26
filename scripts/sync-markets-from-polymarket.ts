/**
 * Sync Markets from Polymarket API
 *
 * Fetches all active markets from Polymarket and updates the database
 * This ensures we have fresh market data with clobTokenIds for category omega calculation
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { fetchAllActiveMarkets } from '@/lib/polymarket/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function syncMarketsFromPolymarket() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           SYNC MARKETS FROM POLYMARKET API               ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    // Step 1: Fetch all active markets from Polymarket
    console.log('📡 Fetching all active markets from Polymarket API...\n')
    const markets = await fetchAllActiveMarkets()

    console.log(`✅ Fetched ${markets.length} markets from Polymarket\n`)

    if (markets.length === 0) {
      console.log('❌ No markets returned from API')
      return
    }

    // Step 2: Prepare data for upsert
    console.log('💾 Preparing markets for database upsert...\n')

    const marketsToUpsert = markets.map((market) => ({
      market_id: market.market_id,
      title: market.title,
      description: market.description || '',
      slug: market.slug || '',
      condition_id: market.raw_data?.conditionId || market.raw_data?.condition_id || null,
      category: market.category || 'Other',
      tags: null, // We can populate this later if needed
      image_url: market.image_url || null,
      outcomes: market.outcomes || ['Yes', 'No'],
      current_price: market.current_price || 0,
      outcome_prices: null, // Can add if needed
      volume_24h: market.volume_24h || 0,
      volume_total: market.volume_total || 0,
      liquidity: market.liquidity || 0,
      active: market.active,
      closed: market.closed,
      end_date: market.end_date ? new Date(market.end_date).toISOString() : null,
      raw_polymarket_data: market.raw_data || {},
    }))

    // Step 3: Upsert markets in batches
    const batchSize = 100
    let upserted = 0
    let errors = 0

    console.log(`📊 Upserting ${marketsToUpsert.length} markets in batches of ${batchSize}...\n`)

    for (let i = 0; i < marketsToUpsert.length; i += batchSize) {
      const batch = marketsToUpsert.slice(i, i + batchSize)
      const batchNumber = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(marketsToUpsert.length / batchSize)

      console.log(`  [${batchNumber}/${totalBatches}] Upserting batch of ${batch.length} markets...`)

      const { error } = await supabase
        .from('markets')
        .upsert(batch, {
          onConflict: 'market_id',
          ignoreDuplicates: false, // Update existing rows
        })

      if (error) {
        console.log(`  ❌ Batch ${batchNumber} error:`, error.message)
        errors++
      } else {
        console.log(`  ✅ Batch ${batchNumber} upserted successfully`)
        upserted += batch.length
      }

      // Rate limit: 100ms between batches
      if (i + batchSize < marketsToUpsert.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // Step 4: Verify clobTokenIds coverage
    console.log('\n📊 Verifying clobTokenIds coverage...\n')

    const { data: sampleMarkets } = await supabase
      .from('markets')
      .select('market_id, category, raw_polymarket_data')
      .not('category', 'is', null)
      .limit(10)

    let withClobTokenIds = 0
    let withConditionId = 0

    sampleMarkets?.forEach((market) => {
      const hasClobTokenIds = market.raw_polymarket_data?.clobTokenIds
      const hasConditionId = market.raw_polymarket_data?.conditionId || market.raw_polymarket_data?.condition_id

      if (hasClobTokenIds) withClobTokenIds++
      if (hasConditionId) withConditionId++
    })

    console.log(`Sample verification (10 markets):`)
    console.log(`  Markets with clobTokenIds: ${withClobTokenIds}/10`)
    console.log(`  Markets with conditionId: ${withConditionId}/10`)

    // Step 5: Summary
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('                        SUMMARY                            ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log(`✅ Total markets fetched: ${markets.length}`)
    console.log(`✅ Total markets upserted: ${upserted}`)
    console.log(`❌ Errors: ${errors}`)

    if (errors === 0) {
      console.log('\n🎉 Market sync complete! Ready to run category omega calculation.')
      console.log('   Next step: npx tsx scripts/calculate-category-omega.ts\n')
    } else {
      console.log('\n⚠️  Some errors occurred during sync. Check logs above.\n')
    }

  } catch (error) {
    console.error('\n❌ Fatal error during market sync:', error)
    throw error
  }
}

syncMarketsFromPolymarket()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
