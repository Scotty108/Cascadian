#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE erc1155_transfers',
    format: 'JSONEachRow'
  })

  const schema = await result.json()
  console.log('erc1155_transfers schema:')
  schema.forEach((col: any) => console.log(`  ${col.name}: ${col.type}`))
}

main().catch(console.error)
