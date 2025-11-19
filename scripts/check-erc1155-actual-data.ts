#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function check() {
  console.log('\n' + '='.repeat(120))
  console.log('Check: What data is actually in erc1155_transfers?')
  console.log('='.repeat(120))
  
  // Full schema
  console.log('\nFull schema:')
  const schemaResult = await clickhouse.query({
    query: `DESCRIBE TABLE erc1155_transfers`,
    format: 'JSONEachRow'
  })
  
  const schema = await schemaResult.json()
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`)
  }
  
  // Sample row
  console.log('\nSample rows (first 3):')
  const sampleResult = await clickhouse.query({
    query: `SELECT * FROM erc1155_transfers LIMIT 3`,
    format: 'JSONEachRow'
  })
  
  const samples = await sampleResult.json()
  for (let i = 0; i < samples.length; i++) {
    console.log(`\n--- Row ${i+1} ---`)
    const row = samples[i]
    for (const [key, value] of Object.entries(row)) {
      const valStr = String(value).substring(0, 100)
      console.log(`  ${key}: ${valStr}`)
    }
  }
}

check().catch(e => console.error('Error:', (e as Error).message))
