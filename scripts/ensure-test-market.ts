import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function ensureTestMarket() {
  const conditionId = '0xf398b0e5016eeaee9b0885ed84012b6dc91269ac10d3b59d60722859c2e30b2f'
  const marketTitle = 'Will Harvey Weinstein be sentenced to no prison time?'

  console.log('🔍 Checking if test market exists in database...\n')

  // Check if market exists with this condition_id
  const { data: existing, error: searchError } = await supabase
    .from('markets')
    .select('*')
    .eq('condition_id', conditionId)
    .single()

  if (existing) {
    console.log('✅ Market already exists:')
    console.log(`   Market ID: ${existing.market_id}`)
    console.log(`   Title: ${existing.title}`)
    console.log(`   Condition ID: ${existing.condition_id}`)
    return
  }

  // Search by title
  console.log('Searching by title...')
  const { data: byTitle, error: titleError } = await supabase
    .from('markets')
    .select('*')
    .ilike('title', `%Harvey Weinstein%`)
    .limit(5)

  if (byTitle && byTitle.length > 0) {
    console.log(`\n✅ Found ${byTitle.length} market(s) matching title:\n`)
    byTitle.forEach((m, i) => {
      console.log(`${i + 1}. Market ID: ${m.market_id}`)
      console.log(`   Title: ${m.title}`)
      console.log(`   Condition ID: ${m.condition_id || '(not set)'}`)
      console.log()
    })

    if (!byTitle[0].condition_id) {
      console.log('📝 Updating market with condition_id...')
      const { error: updateError } = await supabase
        .from('markets')
        .update({ condition_id: conditionId })
        .eq('market_id', byTitle[0].market_id)

      if (updateError) {
        console.error('❌ Error updating market:', updateError)
      } else {
        console.log('✅ Updated market with condition_id')
      }
    }
    return
  }

  console.log('\n⚠️  Market not found in database')
  console.log('   This is okay - the sync script will skip trades for unknown markets')
  console.log('   You can either:')
  console.log('   1. Sync all markets from Polymarket first')
  console.log('   2. Use a different test wallet from a market in your database')
}

ensureTestMarket()
