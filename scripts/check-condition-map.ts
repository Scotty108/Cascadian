#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('\n=== Check if event_id 4690 exists in events_dim ===\n')

  const result = await clickhouse.query({
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

  const rows = await result.json() as any[]
  console.log(JSON.stringify(rows, null, 2))
}

main()
