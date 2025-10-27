#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('\n📊 Checking wallet counts...\n')

  // Check discovered_wallets
  const { count: discoveredCount, error: discoveredError } = await supabase
    .from('discovered_wallets')
    .select('*', { count: 'exact', head: true })

  if (discoveredError) {
    console.error('❌ Error querying discovered_wallets:', discoveredError)
  } else {
    console.log(`✅ discovered_wallets table: ${discoveredCount?.toLocaleString()} wallets`)
  }

  // Check wallet_scores
  const { count: scoresCount, error: scoresError } = await supabase
    .from('wallet_scores')
    .select('*', { count: 'exact', head: true })

  if (scoresError) {
    console.error('❌ Error querying wallet_scores:', scoresError)
  } else {
    console.log(`✅ wallet_scores table: ${scoresCount?.toLocaleString()} wallets`)
  }

  // Sample a few wallet addresses from discovered_wallets
  const { data: sampleWallets, error: sampleError } = await supabase
    .from('discovered_wallets')
    .select('wallet_address, discovered_at')
    .limit(5)

  if (sampleError) {
    console.error('\n❌ Error getting sample:', sampleError)
  } else {
    console.log('\n📝 Sample wallets from discovered_wallets:')
    sampleWallets?.forEach((w, i) => {
      console.log(`   ${i + 1}. ${w.wallet_address} (discovered: ${w.discovered_at})`)
    })
  }
}

main()
