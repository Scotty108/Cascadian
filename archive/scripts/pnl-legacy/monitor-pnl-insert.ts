#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  console.log('\n📊 MONITORING pm_wallet_market_pnl INSERT...')
  
  // Check table row count
  const countResult = await clickhouse.query({
    query: `SELECT count() as rows FROM pm_wallet_market_pnl`,
    format: 'JSONEachRow'
  })
  const countData = await countResult.json()
  console.log('\nTable rows:', countData)

  // Check running processes
  const processResult = await clickhouse.query({
    query: `SELECT 
              query_id, 
              round(elapsed) as seconds,
              formatReadableQuantity(read_rows) as rows_read,
              formatReadableQuantity(written_rows) as rows_written,
              formatReadableSize(memory_usage) as memory
            FROM system.processes 
            WHERE query LIKE '%pm_wallet_market_pnl%' 
              AND query NOT LIKE '%system.processes%'`,
    format: 'JSONEachRow'
  })
  const processData = await processResult.json()
  
  if (processData.length > 0) {
    console.log('\n🔄 Running INSERT:')
    processData.forEach((p: any) => {
      console.log(`  - Elapsed: ${p.seconds}s | Read: ${p.rows_read} | Written: ${p.rows_written} | Memory: ${p.memory}`)
    })
  } else {
    console.log('\n✅ No INSERT running - may be complete!')
  }

  await clickhouse.close()
}

main().catch(console.error)
