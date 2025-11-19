#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

async function checkSchema() {
  console.log('Checking erc1155_transfers schema...\n')

  const result = await ch.query({
    query: 'DESCRIBE TABLE erc1155_transfers',
    format: 'JSONEachRow'
  })

  const schema = await result.json()
  console.log('Schema:')
  schema.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`)
  })

  console.log('\nSample row:')
  const sample = await ch.query({
    query: 'SELECT * FROM erc1155_transfers LIMIT 1',
    format: 'JSONEachRow'
  })
  const sampleData = await sample.json()
  console.log(JSON.stringify(sampleData[0], null, 2))
}

checkSchema().catch(console.error)
