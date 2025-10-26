/**
 * Fast Market Sync from Polymarket API
 *
 * Optimized version:
 * - Insert new markets only (skip updates)
 * - Smaller batch size to avoid timeouts
 * - Focus on getting clobTokenIds into database
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

async function syncMarketsFast() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('         FAST MARKET SYNC FROM POLYMARKET API             ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    // Step 1: Fetch all active markets
    console.log('📡 Fetching markets from Polymarket API...\n')
    const markets = await fetchAllActiveMarkets()

    console.log(`✅ Fetched ${markets.length} markets\n`)

    if (markets.length === 0) {
      console.log('❌ No markets returned')
      return
    }

    // Step 2: Get existing market IDs to skip updates
    console.log('🔍 Checking existing markets in database...\n')
    const { data: existingMarkets } = await supabase
      .from('markets')
      .select('market_id')

    const existingIds = new Set(existingMarkets?.map(m => m.market_id) || [])
    console.log(`📊 Found ${existingIds.size} existing markets in database\n`)

    // Step 3: Filter to new markets only
    const newMarkets = markets.filter(m => !existingIds.has(m.market_id))
    console.log(`🆕 ${newMarkets.length} new markets to insert\n`)

    if (newMarkets.length === 0) {
      console.log('✅ Database is up to date! All markets already exist.\n')
      return
    }

    // Step 4: Prepare data for insert
    const marketsToInsert = newMarkets.map((market) => ({
      market_id: market.market_id,
      title: market.title,
      description: market.description || '',
      slug: market.slug || '',
      condition_id: market.raw_data?.conditionId || market.raw_data?.condition_id || null,
      category: market.category || 'Other',
      tags: null,
      image_url: market.image_url || null,
      outcomes: market.outcomes || ['Yes', 'No'],
      current_price: market.current_price || 0,
      outcome_prices: null,
      volume_24h: market.volume_24h || 0,
      volume_total: market.volume_total || 0,
      liquidity: market.liquidity || 0,
      active: market.active,
      closed: market.closed,
      end_date: market.end_date ? new Date(market.end_date).toISOString() : null,
      raw_polymarket_data: market.raw_data || {},
    }))

    // Step 5: Insert in small batches
    const batchSize = 10 // Smaller batches to avoid timeout
    let inserted = 0
    let errors = 0

    console.log(`📊 Inserting ${marketsToInsert.length} markets in batches of ${batchSize}...\n`)

    for (let i = 0; i < marketsToInsert.length; i += batchSize) {
      const batch = marketsToInsert.slice(i, i + batchSize)
      const batchNumber = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(marketsToInsert.length / batchSize)

      process.stdout.write(`  [${batchNumber}/${totalBatches}] Inserting batch ${batchNumber}... `)

      const { error } = await supabase
        .from('markets')
        .upsert(batch, {
          onConflict: 'market_id',
          ignoreDuplicates: true, // Skip if already exists
        })

      if (error) {
        console.log(`❌ ${error.message}`)
        errors++
      } else {
        console.log(`✅`)
        inserted += batch.length
      }

      // Progress update every 50 batches
      if (batchNumber % 50 === 0) {
        console.log(`\n  Progress: ${inserted} inserted, ${errors} errors\n`)
      }

      // Small delay between batches
      if (i + batchSize < marketsToInsert.length) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    // Step 6: Verify clobTokenIds
    console.log('\n📊 Verifying clobTokenIds in database...\n')

    const { data: sampleMarkets } = await supabase
      .from('markets')
      .select('market_id, category, raw_polymarket_data')
      .in('market_id', marketsToInsert.slice(0, 10).map(m => m.market_id))

    let withClobTokenIds = 0
    sampleMarkets?.forEach((market) => {
      if (market.raw_polymarket_data?.clobTokenIds) {
        withClobTokenIds++
      }
    })

    console.log(`Sample verification (10 markets): ${withClobTokenIds}/10 have clobTokenIds\n`)

    // Step 7: Summary
    console.log('═══════════════════════════════════════════════════════════')
    console.log('                        SUMMARY                            ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log(`✅ Total new markets inserted: ${inserted}`)
    console.log(`❌ Errors: ${errors}`)
    console.log(`📊 Database now has ${existingIds.size + inserted} total markets`)

    if (inserted > 0 && withClobTokenIds > 0) {
      console.log('\n🎉 Market sync complete! clobTokenIds are in database.')
      console.log('   Ready to run: npx tsx scripts/calculate-category-omega.ts\n')
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    throw error
  }
}

syncMarketsFast()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
