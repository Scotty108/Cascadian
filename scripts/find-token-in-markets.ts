/**
 * Search for a specific tokenId in markets table
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function findTokenInMarkets() {
  const searchTokenId = '100380077260182342688664357628238353231349777159985250488201013241374952890543'

  console.log(`🔍 Searching for tokenId: ${searchTokenId}\n`)

  // Get all markets with categories
  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, category, title, raw_polymarket_data')
    .not('category', 'is', null)
    .limit(20000)

  console.log(`📊 Checking ${markets?.length || 0} markets...\n`)

  let found = false
  let checked = 0
  let withTokenIds = 0

  for (const market of markets || []) {
    checked++

    let clobTokenIds = market.raw_polymarket_data?.clobTokenIds

    if (!clobTokenIds) continue

    // Parse if string
    if (typeof clobTokenIds === 'string') {
      try {
        clobTokenIds = JSON.parse(clobTokenIds)
      } catch (e) {
        continue
      }
    }

    if (Array.isArray(clobTokenIds)) {
      withTokenIds++
      if (clobTokenIds.includes(searchTokenId)) {
        found = true
        console.log('✅ FOUND!')
        console.log(`  Market ID: ${market.market_id}`)
        console.log(`  Category: ${market.category}`)
        console.log(`  Title: ${market.title}`)
        console.log(`  Token IDs: ${clobTokenIds.join(', ')}`)
        break
      }
    }

    if (checked % 5000 === 0) {
      console.log(`  Checked ${checked} markets... (${withTokenIds} have tokenIds)`)
    }
  }

  if (!found) {
    console.log('❌ Token ID NOT FOUND in any market')
    console.log(`\nChecked ${checked} markets, ${withTokenIds} had clobTokenIds`)
    console.log('\n💡 This suggests:')
    console.log('  1. The markets table may not have recent/active markets')
    console.log('  2. The clobTokenIds in markets table may be outdated')
    console.log('  3. We may need to fetch fresh market data from Polymarket API')
  }
}

findTokenInMarkets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
