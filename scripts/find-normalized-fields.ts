#!/usr/bin/env npx tsx

/**
 * Find tables with normalized USD/shares fields
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  console.log('Searching for tables with normalized fields...\n')

  const result = await clickhouse.query({
    query: `
      SELECT table, name, type
      FROM system.columns
      WHERE name LIKE '%norm%'
        AND (name LIKE '%usd%' OR name LIKE '%share%')
        AND database = 'default'
      ORDER BY table, name
    `,
    format: 'JSONEachRow'
  })

  const data = await result.json<any>()
  console.log('Found', data.length, 'normalized fields:\n')

  if (data.length > 0) {
    data.forEach((row: any) => {
      console.log(`  ${row.table}.${row.name} (${row.type})`)
    })
  } else {
    console.log('  No normalized fields found.')
    console.log('\n  Implication: Need to divide raw usd_value/shares by 1e6')
  }

  await clickhouse.close()
}

main().catch(console.error)
