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

async function investigate() {
  console.log('═'.repeat(70))
  console.log('INVESTIGATING market_id="12" IN trades_with_direction')
  console.log('═'.repeat(70))
  console.log()

  // Sample trades with market_id='12'
  console.log('Sample trades with market_id="12":')
  const samples = await q(`
    SELECT
      tx_hash,
      wallet_address,
      condition_id_norm,
      market_id,
      shares,
      price,
      direction_from_transfers,
      recovery_status
    FROM trades_with_direction
    WHERE market_id = '12'
    LIMIT 5
  `)

  samples.forEach((trade: any, i: number) => {
    console.log(`\n  Trade ${i + 1}:`)
    console.log(`    tx_hash: ${trade.tx_hash}`)
    console.log(`    condition_id_norm: ${trade.condition_id_norm}`)
    console.log(`    market_id: "${trade.market_id}"`)
    console.log(`    shares: ${trade.shares}`)
    console.log(`    price: ${trade.price}`)
    console.log(`    direction: ${trade.direction_from_transfers}`)
    console.log(`    recovery_status: ${trade.recovery_status}`)
  })
  console.log()

  // Check if condition_id_norm can map to condition_market_map
  console.log('Can we recover market_id from condition_market_map?')
  const recoverable = await q(`
    SELECT COUNT(*) as matches
    FROM trades_with_direction t
    INNER JOIN condition_market_map cmm ON t.condition_id_norm = cmm.condition_id
    WHERE t.market_id = '12'
    LIMIT 1000000
  `)

  console.log(`  Matches in condition_market_map: ${Number(recoverable[0].matches).toLocaleString()}`)

  if (Number(recoverable[0].matches) > 0) {
    console.log('  ✅ YES! We can recover these via condition_market_map')
    console.log()
    console.log('Recovery query:')
    console.log(`
    UPDATE trades_with_direction t
    SET market_id = (
      SELECT market_id FROM condition_market_map
      WHERE condition_id = t.condition_id_norm
      LIMIT 1
    )
    WHERE market_id = '12'
      AND condition_id_norm IN (SELECT condition_id FROM condition_market_map)
    `)
  } else {
    console.log('  ❌ NO matches - need alternative strategy')
  }
  console.log()

  console.log('═'.repeat(70))
}

investigate().catch(console.error)
