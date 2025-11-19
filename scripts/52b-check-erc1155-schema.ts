#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Checking erc1155_transfers schema...\n')

  const schema = await (await clickhouse.query({
    query: `
      SELECT
        name,
        type
      FROM system.columns
      WHERE database = 'default' AND table = 'erc1155_transfers'
      ORDER BY position
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log('erc1155_transfers columns:')
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`)
  }

  console.log('\n\nFirst 5 rows:')
  const sample = await (await clickhouse.query({
    query: `SELECT * FROM erc1155_transfers LIMIT 5`,
    format: 'JSONEachRow'
  })).json() as any[]

  if (sample.length > 0) {
    console.log(JSON.stringify(sample[0], null, 2))
  }

  // Check erc20_transfers schema too
  console.log('\n\nerc20_transfers columns:')
  const schema2 = await (await clickhouse.query({
    query: `
      SELECT
        name,
        type
      FROM system.columns
      WHERE database = 'default' AND table = 'erc20_transfers'
      ORDER BY position
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  for (const col of schema2) {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`)
  }
}

main().catch(e => console.error('Error:', e))
