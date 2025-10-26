/**
 * Check condition_id coverage in markets table
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkConditionIds() {
  console.log('🔍 Checking condition_id coverage in markets table\n')

  // Total markets
  const { count: totalMarkets } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })

  // Markets with condition_id
  const { count: marketsWithConditionId } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .not('condition_id', 'is', null)

  // Markets with category
  const { count: marketsWithCategory } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .not('category', 'is', null)

  // Markets with BOTH condition_id and category
  const { count: marketsWithBoth } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .not('condition_id', 'is', null)
    .not('category', 'is', null)

  console.log('📊 Markets Table Coverage:')
  console.log(`  Total markets: ${totalMarkets}`)
  console.log(`  With condition_id: ${marketsWithConditionId} (${((marketsWithConditionId! / totalMarkets!) * 100).toFixed(1)}%)`)
  console.log(`  With category: ${marketsWithCategory} (${((marketsWithCategory! / totalMarkets!) * 100).toFixed(1)}%)`)
  console.log(`  With BOTH: ${marketsWithBoth} (${((marketsWithBoth! / totalMarkets!) * 100).toFixed(1)}%)`)

  if (marketsWithBoth && marketsWithBoth > 0) {
    // Show sample markets with both
    const { data: sampleMarkets } = await supabase
      .from('markets')
      .select('condition_id, category, title')
      .not('condition_id', 'is', null)
      .not('category', 'is', null)
      .limit(5)

    console.log('\n✅ Sample markets with both condition_id and category:')
    sampleMarkets?.forEach(m => {
      console.log(`  ${m.condition_id.substring(0, 20)}... | ${m.category.padEnd(10)} | ${m.title.substring(0, 40)}...`)
    })
  } else {
    console.log('\n❌ No markets have both condition_id and category populated')
    console.log('\n💡 Solution: We need to fetch condition_ids from Polymarket API')
    console.log('   The raw_polymarket_data.conditionId field might help')

    // Check if raw data has conditionId
    const { data: sampleWithRaw } = await supabase
      .from('markets')
      .select('condition_id, category, raw_polymarket_data')
      .not('category', 'is', null)
      .limit(3)

    console.log('\n📋 Checking raw_polymarket_data for conditionId:')
    sampleWithRaw?.forEach((m: any) => {
      const rawConditionId = m.raw_polymarket_data?.conditionId || m.raw_polymarket_data?.condition_id
      console.log(`  Category: ${m.category.padEnd(10)} | Raw conditionId: ${rawConditionId || 'MISSING'}`)
    })
  }
}

checkConditionIds()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
