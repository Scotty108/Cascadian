#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function checkResolved() {
  const total = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const totalData = await total.json()
  console.log('Total trades:', totalData[0].count)

  const resolved = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE is_resolved = 1',
    format: 'JSONEachRow'
  })
  const resolvedData = await resolved.json()
  console.log('Resolved trades:', resolvedData[0].count)

  const enriched = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE market_id != \'\'',
    format: 'JSONEachRow'
  })
  const enrichedData = await enriched.json()
  console.log('Enriched trades (market_id set):', enrichedData[0].count)

  const enrichedResolved = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE market_id != \'\' AND is_resolved = 1',
    format: 'JSONEachRow'
  })
  const enrichedResolvedData = await enrichedResolved.json()
  console.log('Enriched AND resolved:', enrichedResolvedData[0].count)
}

checkResolved()
