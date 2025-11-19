#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('Analyzing market status for enriched trades...\n')

  // Get unique market_ids from enriched trades
  const tradesResult = await clickhouse.query({
    query: `
      SELECT DISTINCT market_id
      FROM trades_raw
      WHERE market_id != '' AND is_resolved = 0
      LIMIT 5000
    `,
    format: 'JSONEachRow'
  })
  const tradeMarkets: any = await tradesResult.json()
  const marketIds = tradeMarkets.map((t: any) => t.market_id)

  console.log('Checking status of', marketIds.length, 'unique markets from unenriched trades...\n')

  // Query Supabase in batches
  const batchSize = 1000
  let activeCount = 0
  let closedCount = 0
  let notFoundCount = 0

  for (let i = 0; i < marketIds.length; i += batchSize) {
    const batch = marketIds.slice(i, i + batchSize)

    const { data, error } = await supabase
      .from('markets')
      .select('market_id, active, closed')
      .in('market_id', batch)

    if (error) {
      console.error('Error:', error)
      continue
    }

    const foundIds = new Set(data.map(m => m.market_id))
    notFoundCount += batch.length - data.length

    for (const market of data) {
      if (market.active) {
        activeCount++
      } else if (market.closed) {
        closedCount++
      }
    }

    if (i % 2000 === 0 && i > 0) {
      console.log(`Processed ${i} / ${marketIds.length} markets...`)
    }
  }

  console.log('\nMarket Status Breakdown:')
  console.log('  Active (still open):', activeCount, `(${(activeCount/marketIds.length*100).toFixed(1)}%)`)
  console.log('  Closed (resolved):', closedCount, `(${(closedCount/marketIds.length*100).toFixed(1)}%)`)
  console.log('  Not in Supabase:', notFoundCount, `(${(notFoundCount/marketIds.length*100).toFixed(1)}%)`)
  console.log('\nConclusion:')
  if (closedCount > activeCount) {
    console.log('  ⚠️  Most markets are CLOSED - we need to fetch resolution data from blockchain')
  } else {
    console.log('  ✅ Most markets are still ACTIVE - wallets are trading on open markets')
  }
}

main()
