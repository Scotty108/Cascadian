#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkOutcomePrices() {
  console.log('Checking outcomePrices structure...\n')

  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, title, closed, raw_polymarket_data')
    .not('raw_polymarket_data', 'is', null)
    .limit(20)

  markets?.forEach((m, i) => {
    const raw = m.raw_polymarket_data as any

    if (raw?.outcomePrices) {
      console.log(`\n[${i+1}] ${m.title?.substring(0, 40)}...`)
      console.log(`    Closed: ${m.closed}`)
      console.log(`    outcomePrices: ${JSON.stringify(raw.outcomePrices)}`)
      console.log(`    resolvedOutcome: ${raw.resolvedOutcome}`)
      console.log(`    active: ${raw.active}`)
    }
  })
}

checkOutcomePrices()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error)
    process.exit(1)
  })
