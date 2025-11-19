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

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

async function checkRecovery() {
  console.log('═'.repeat(70))
  console.log('RECOVERY POTENTIAL FOR market_id="12"')
  console.log('═'.repeat(70))
  console.log()

  // Get distinct condition_ids with market_id='12'
  const missing = await q(`
    SELECT DISTINCT condition_id_norm
    FROM trades_with_direction
    WHERE market_id = '12'
  `)

  console.log(`Total condition_ids needing recovery: ${missing.length.toLocaleString()}`)
  console.log()

  // Check how many exist in condition_market_map
  console.log('Checking condition_market_map...')
  const inMap = await q(`
    SELECT COUNT(*) as matches
    FROM (
      SELECT DISTINCT condition_id_norm FROM trades_with_direction WHERE market_id = '12'
    ) t
    INNER JOIN condition_market_map cmm ON lower(t.condition_id_norm) = lower(cmm.condition_id)
  `)

  const mapMatches = Number(inMap[0].matches)
  console.log(`  Found in condition_market_map: ${mapMatches.toLocaleString()} (${(mapMatches/missing.length*100).toFixed(1)}%)`)
  console.log()

  if (mapMatches > 0) {
    // Check how many trades would be recovered
    const tradeRecovery = await q(`
      SELECT COUNT(*) as recoverable_trades
      FROM trades_with_direction t
      INNER JOIN condition_market_map cmm ON lower(t.condition_id_norm) = lower(cmm.condition_id)
      WHERE t.market_id = '12'
    `)

    console.log(`  Trades recoverable: ${Number(tradeRecovery[0].recoverable_trades).toLocaleString()}`)
    console.log()
  }

  // Check remaining gap
  const remaining = missing.length - mapMatches
  console.log(`Remaining gap: ${remaining.toLocaleString()} condition_ids`)
  console.log()

  if (remaining > 0) {
    console.log('Options for remaining:')
    console.log('  1. Query CLOB API: POST /markets with condition_ids (instant)')
    console.log('  2. Query Polymarket API: GET /markets/{condition_id} (2-4 hours)')
    console.log('  3. Accept 94.3% coverage and ship (77.5M / 82.1M trades)')
  }

  console.log()
  console.log('═'.repeat(70))
}

checkRecovery().catch(console.error)
