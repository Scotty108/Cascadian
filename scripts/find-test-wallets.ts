import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { getTopWalletsByCondition } from '@/lib/goldsky/client'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function findTestWallets() {
  console.log('🔍 Finding active wallets for testing...\n')

  // Get markets with a condition ID (active or closed)
  console.log('Step 1: Finding markets with condition_id...')
  const { data: markets, error } = await supabase
    .from('markets')
    .select('market_id, condition_id, title, volume, active')
    .not('condition_id', 'is', null)
    .order('volume', { ascending: false })
    .limit(10)

  if (error || !markets || markets.length === 0) {
    console.error('❌ No active markets with condition_id found')
    return
  }

  console.log(`✅ Found ${markets.length} active markets\n`)

  // For each market, get top wallets
  for (const market of markets.slice(0, 3)) {
    // Just check top 3 markets
    console.log(`\n📊 Market: ${market.title}`)
    console.log(`   Market ID: ${market.market_id}`)
    console.log(`   Condition: ${market.condition_id}`)
    console.log(`   Volume: $${market.volume?.toLocaleString() || 0}`)
    console.log(`   Active: ${market.active ? '✅' : '❌'}`)

    try {
      const topWallets = await getTopWalletsByCondition(market.condition_id, 10)

      if (topWallets.length > 0) {
        console.log(`\n   Top ${topWallets.length} wallets by position size:`)
        topWallets.forEach((wallet, i) => {
          console.log(`   ${i + 1}. ${wallet}`)
        })

        if (topWallets.length >= 5) {
          console.log(`\n   ✅ Found enough wallets! Use these for testing:\n`)
          console.log(`   npx tsx scripts/sync-wallet-trades.ts \\`)
          topWallets.slice(0, 5).forEach((wallet, i) => {
            const suffix = i < 4 ? ' \\' : ''
            console.log(`     ${wallet}${suffix}`)
          })
          return topWallets.slice(0, 5)
        }
      } else {
        console.log('   No wallets found for this market')
      }
    } catch (error) {
      console.error(`   ❌ Error fetching wallets:`, error)
    }
  }

  console.log('\n\n⚠️  Could not find enough active wallets')
  console.log('Try running this script again or check different markets')
}

findTestWallets()
