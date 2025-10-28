#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('\n🔧 Inserting event_id 4690 into events_dim\n')

  const insertQuery = `
    INSERT INTO events_dim (
      event_id,
      canonical_category,
      raw_tags,
      title,
      ingested_at
    ) VALUES (
      '4690',
      'US-current-affairs',
      [],
      'Will Joe Biden get Coronavirus before the election?',
      now()
    )
  `

  try {
    await clickhouse.command({ query: insertQuery })
    console.log('✅ Event 4690 inserted successfully\n')
  } catch (error: any) {
    console.error('Error inserting event:', error.message)
  }

  // Verify
  console.log('=== Verification: Query event 4690 ===\n')

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        event_id,
        canonical_category,
        title,
        raw_tags
      FROM events_dim
      WHERE event_id = '4690'
    `,
    format: 'JSONEachRow'
  })

  const rows = await verifyResult.json() as any[]
  console.log(JSON.stringify(rows, null, 2))
}

main()
