#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function investigateMarkets() {
  console.log('🔍 Investigating Market Resolution Status:\n')

  // Check sample of markets with raw_polymarket_data
  const { data: sampleMarkets } = await supabase
    .from('markets')
    .select('market_id, condition_id, title, closed, end_date, raw_polymarket_data')
    .not('raw_polymarket_data', 'is', null)
    .limit(10)

  console.log('Sample markets with Polymarket data:')
  sampleMarkets?.forEach((m, i) => {
    const raw = m.raw_polymarket_data as any
    console.log(`\n[${i+1}] ${m.title?.substring(0, 50)}...`)
    console.log(`    DB closed: ${m.closed}`)
    console.log(`    End date: ${m.end_date}`)
    console.log(`    PM closed: ${raw?.closed}`)
    console.log(`    PM active: ${raw?.active}`)
    console.log(`    PM resolved: ${raw?.resolvedOutcome !== undefined}`)
    console.log(`    PM outcome: ${raw?.resolvedOutcome}`)
  })

  // Check how many have resolved outcomes in raw data
  const { data: allMarkets } = await supabase
    .from('markets')
    .select('market_id, closed, raw_polymarket_data')
    .not('raw_polymarket_data', 'is', null)

  const withResolvedOutcome = allMarkets?.filter(m => {
    const raw = m.raw_polymarket_data as any
    return raw?.resolvedOutcome !== undefined && raw?.resolvedOutcome !== null
  }).length || 0

  const withClosedFlag = allMarkets?.filter(m => {
    const raw = m.raw_polymarket_data as any
    return raw?.closed === true
  }).length || 0

  const withActiveFlag = allMarkets?.filter(m => {
    const raw = m.raw_polymarket_data as any
    return raw?.active === false
  }).length || 0

  console.log(`\n\n📊 Data Analysis:`)
  console.log(`Total markets with Polymarket data: ${allMarkets?.length}`)
  console.log(`Markets with resolvedOutcome in raw data: ${withResolvedOutcome}`)
  console.log(`Markets with closed=true in raw data: ${withClosedFlag}`)
  console.log(`Markets with active=false in raw data: ${withActiveFlag}`)
  console.log(`Markets with closed=true in DB: 692`)
  console.log(`\n⚠️  Gap: ${withResolvedOutcome - 692} resolved markets not marked as closed in DB`)
}

investigateMarkets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error)
    process.exit(1)
  })
