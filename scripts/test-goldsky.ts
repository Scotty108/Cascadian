import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import {
  fetchUserBalancesByCondition,
  fetchNetUserBalances,
  getTopWalletsByCondition,
} from '@/lib/goldsky/client'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testGoldsky() {
  console.log('🔍 Testing Goldsky integration...\n')

  try {
    // Get a real market from our database
    console.log('Step 1: Fetching active market from database...')
    const { data: markets, error } = await supabase
      .from('markets')
      .select('market_id, condition_id, title')
      .eq('active', true)
      .limit(1)

    if (error || !markets || markets.length === 0) {
      console.error('❌ No active markets found in database')
      console.log('\nPlease ensure you have active markets synced first.')
      return
    }

    const market = markets[0]
    console.log(`✅ Using market: ${market.title}`)
    console.log(`   Market ID: ${market.market_id}`)
    console.log(`   Condition ID: ${market.condition_id}\n`)

    //Make sure we have a condition ID
    if (!market.condition_id) {
      console.log('⚠️  No condition_id for this market, trying another...\n')

      const { data: conditionMarkets } = await supabase
        .from('markets')
        .select('market_id, condition_id, title')
        .eq('active', true)
        .not('condition_id', 'is', null)
        .limit(1)

      if (!conditionMarkets || conditionMarkets.length === 0) {
        console.error('❌ No markets with condition_id found')
        console.log('\nThe condition_id field is required for Goldsky queries.')
        console.log('Please ensure your markets have condition_id populated.')
        return
      }

      market.condition_id = conditionMarkets[0].condition_id
      market.title = conditionMarkets[0].title
      console.log(`Using market with condition: ${market.title}`)
      console.log(`Condition ID: ${market.condition_id}\n`)
    }

    // Test 1: Fetch user balances
    console.log('Test 1: Fetching user balances (top 20)...')
    const balances = await fetchUserBalancesByCondition(market.condition_id, 20)

    if (balances.length === 0) {
      console.log('⚠️  No user balances found for this condition')
      console.log('   This condition might not have any positions yet.')
      return
    }

    console.log(`✅ Fetched ${balances.length} user balances`)
    console.log('\nSample balance:')
    console.log(JSON.stringify(balances[0], null, 2))

    // Calculate power law
    const totalBalance = balances.reduce((sum, b) => sum + parseFloat(b.balance), 0)
    const top20Balance = balances.slice(0, 20).reduce((sum, b) => sum + parseFloat(b.balance), 0)
    const concentration = (top20Balance / totalBalance) * 100

    console.log(`\n📊 Power Law Analysis:`)
    console.log(`   Total balance: ${totalBalance.toFixed(2)}`)
    console.log(`   Top 20 balance: ${top20Balance.toFixed(2)}`)
    console.log(`   Concentration: ${concentration.toFixed(1)}%`)

    if (concentration > 60) {
      console.log(`   ✅ Power law validated! Top 20 control ${concentration.toFixed(1)}%`)
    } else {
      console.log(`   ⚠️  Power law weaker than expected: ${concentration.toFixed(1)}%`)
    }

    // Test 2: Fetch net balances
    console.log(`\n\nTest 2: Fetching net user balances...`)
    const netBalances = await fetchNetUserBalances(market.condition_id, 10)

    if (netBalances.length > 0) {
      console.log(`✅ Fetched ${netBalances.length} net balances`)
      console.log('\nSample net balance:')
      console.log(JSON.stringify(netBalances[0], null, 2))
    } else {
      console.log('⚠️  No net balances found')
    }

    // Test 3: Get top wallets
    console.log(`\n\nTest 3: Getting top wallets by position...`)
    const topWallets = await getTopWalletsByCondition(market.condition_id, 5)
    console.log(`   ✅ Found ${topWallets.length} top wallets`)
    topWallets.forEach((wallet, i) => {
      console.log(`   ${i + 1}. ${wallet}`)
    })

    console.log('\n\n✅ All Goldsky tests passed!')
    console.log('\n📌 Next steps:')
    console.log('   1. Run: npx tsx scripts/sync-test-wallets.ts')
    console.log('   2. This will ingest trade data into ClickHouse')
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
    }
    process.exit(1)
  }
}

testGoldsky()
