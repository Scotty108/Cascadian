/**
 * Debug Category Mapping Issue
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { pnlClient } from '@/lib/goldsky/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debugCategoryMapping() {
  console.log('🔍 Debugging Category Mapping\n')

  // Check sample markets
  const { data: markets } = await supabase
    .from('markets')
    .select('condition_id, category, question')
    .not('category', 'is', null)
    .limit(5)

  console.log('📊 Sample markets with categories:')
  markets?.forEach((m) => {
    console.log(`  ${m.condition_id.substring(0, 30)}... | ${m.category.padEnd(15)} | ${m.question.substring(0, 40)}...`)
  })

  // Check sample position tokenIds
  const posQuery = `
    query {
      userPositions(first: 5, where: { realizedPnl_gt: "0" }) {
        tokenId
        realizedPnl
        user
      }
    }
  `

  const posData: any = await pnlClient.request(posQuery)

  console.log('\n🎯 Sample position tokenIds from Goldsky:')
  posData.userPositions.forEach((p: any) => {
    console.log(`  ${p.tokenId}`)
  })

  // Check if any tokenId matches a condition_id
  console.log('\n🔎 Checking for matches...')
  const tokenIds = posData.userPositions.map((p: any) => p.tokenId)

  const { data: matchingMarkets } = await supabase
    .from('markets')
    .select('condition_id, category')
    .in('condition_id', tokenIds)

  console.log(`Found ${matchingMarkets?.length || 0} matches between tokenIds and condition_ids`)

  if (matchingMarkets && matchingMarkets.length > 0) {
    console.log('✅ Matches found:')
    matchingMarkets.forEach(m => {
      console.log(`  ${m.condition_id} → ${m.category}`)
    })
  } else {
    console.log('❌ No direct matches found')
    console.log('\n💡 tokenId might need transformation or markets table might use different ID format')
    console.log('   Check if markets table uses clob_token_ids instead of condition_id')
  }

  // Check alternative: Look for clob_token_ids
  const { data: marketSample } = await supabase
    .from('markets')
    .select('*')
    .not('category', 'is', null)
    .limit(1)
    .single()

  console.log('\n📋 Full market record structure:')
  console.log(JSON.stringify(marketSample, null, 2))
}

debugCategoryMapping()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
