#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function test() {
  console.log('Checking erc20_transfers schema...\n')
  
  const result = await clickhouse.query({
    query: `DESCRIBE TABLE erc20_transfers`,
    format: 'JSONEachRow'
  })
  
  const schema = await result.json()
  console.log('Columns:')
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`)
  }
  
  // Now get a sample row
  console.log('\nSample row:')
  const sampleResult = await clickhouse.query({
    query: `SELECT * FROM erc20_transfers LIMIT 1 FORMAT JSONEachRow`,
    format: 'JSONEachRow'
  })
  const sample = await sampleResult.json()
  if (sample.length > 0) {
    console.log(JSON.stringify(sample[0], null, 2).substring(0, 500))
  }
}

test().catch(e => console.error('Error:', (e as Error).message))
