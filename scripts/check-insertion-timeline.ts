#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  // Check insertion timeline
  const timelineQuery = `
    SELECT
      toStartOfHour(created_at) as hour,
      COUNT(*) as inserts,
      COUNT(DISTINCT wallet_address) as unique_wallets,
      COUNT(CASE WHEN condition_id LIKE 'token_%' THEN 1 END) as placeholder_trades
    FROM trades_raw
    GROUP BY toStartOfHour(created_at)
    ORDER BY hour DESC
    LIMIT 48
  `

  console.log("=== INSERTION TIMELINE (Last 48 Hours) ===\n")
  const result = await clickhouse.query({ query: timelineQuery, format: 'JSONEachRow' })
  const timeline = await result.json() as any[]

  for (const row of timeline) {
    const hour = new Date(row.hour).toLocaleString()
    console.log(`${hour}: ${row.inserts} trades | ${row.unique_wallets} unique wallets | ${row.placeholder_trades} placeholder`)
  }

  // Check total by condition_id type
  console.log("\n=== BREAKDOWN BY CONDITION_ID TYPE ===\n")
  const breakdownQuery = `
    SELECT
      CASE
        WHEN condition_id LIKE 'token_%' THEN 'Emergency Load (placeholder)'
        WHEN condition_id = '' THEN 'Empty'
        ELSE 'Real condition_id'
      END as type,
      COUNT(*) as trades,
      COUNT(DISTINCT wallet_address) as unique_wallets
    FROM trades_raw
    GROUP BY type
  `

  const breakdownResult = await clickhouse.query({ query: breakdownQuery, format: 'JSONEachRow' })
  const breakdown = await breakdownResult.json() as any[]

  for (const row of breakdown) {
    console.log(`${row.type}: ${row.trades} trades | ${row.unique_wallets} wallets`)
  }

  // Check earliest and latest timestamps
  console.log("\n=== TIMESTAMP RANGE ===\n")
  const rangeQuery = `
    SELECT
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest,
      COUNT(*) as total_trades,
      COUNT(DISTINCT wallet_address) as total_wallets
    FROM trades_raw
  `

  const rangeResult = await clickhouse.query({ query: rangeQuery, format: 'JSONEachRow' })
  const range = await rangeResult.json() as any[]

  const row = range[0]
  console.log(`Earliest trade: ${new Date(row.earliest * 1000).toLocaleString()}`)
  console.log(`Latest trade: ${new Date(row.latest * 1000).toLocaleString()}`)
  console.log(`Total trades: ${row.total_trades}`)
  console.log(`Total wallets: ${row.total_wallets}`)
}

main().catch(console.error)
