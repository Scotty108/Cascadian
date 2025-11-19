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

async function canWeEnrich() {
  console.log('═'.repeat(70))
  console.log('CAN WE ENRICH THE 77M MISSING TRADES IN vw_trades_canonical?')
  console.log('═'.repeat(70))
  console.log()

  // Check 1: What data DO the missing trades have?
  console.log('1. What data do the 77M "broken" trades have?')
  console.log('-'.repeat(70))

  const sample = await q(`
    SELECT
      transaction_hash,
      wallet_address_norm,
      market_id_norm,
      condition_id_norm,
      shares,
      usd_value,
      entry_price
    FROM vw_trades_canonical
    WHERE condition_id_norm = '' OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
    LIMIT 5
  `)

  console.log('Sample "broken" trades:')
  sample.forEach((trade: any, i: number) => {
    console.log(`\n  Trade ${i + 1}:`)
    console.log(`    tx_hash: ${trade.transaction_hash}`)
    console.log(`    wallet: ${trade.wallet_address_norm}`)
    console.log(`    market_id: ${trade.market_id_norm}`)
    console.log(`    condition_id: ${trade.condition_id_norm}`)
    console.log(`    shares: ${trade.shares}`)
    console.log(`    usd_value: ${trade.usd_value}`)
  })
  console.log()

  // Check 2: Can we join via tx_hash to get condition_ids?
  console.log('2. Can we recover condition_ids via tx_hash JOIN?')
  console.log('-'.repeat(70))

  // Try joining to trades_with_direction
  const joinDirection = await q(`
    SELECT count() as matches
    FROM vw_trades_canonical c
    INNER JOIN trades_with_direction d ON c.transaction_hash = d.tx_hash
    WHERE c.condition_id_norm = '' OR c.condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
    LIMIT 10000000
  `)

  console.log(`  Matches with trades_with_direction (via tx_hash): ${Number(joinDirection[0].matches).toLocaleString()}`)
  console.log()

  // Try joining to erc1155_transfers
  const joinERC1155 = await q(`
    SELECT count() as matches
    FROM (
      SELECT DISTINCT transaction_hash
      FROM vw_trades_canonical
      WHERE condition_id_norm = '' OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 100000
    ) c
    INNER JOIN erc1155_transfers e ON c.transaction_hash = e.tx_hash
  `)

  console.log(`  Sample 100K broken trades: ${Number(joinERC1155[0].matches).toLocaleString()} match erc1155_transfers`)
  console.log()

  // Check 3: What if we JOIN to trade_direction_assignments?
  console.log('3. Can trade_direction_assignments fill the gap?')
  console.log('-'.repeat(70))

  const joinAssignments = await q(`
    SELECT count() as matches
    FROM vw_trades_canonical c
    INNER JOIN trade_direction_assignments d ON c.transaction_hash = d.tx_hash AND c.wallet_address_norm = d.wallet_address
    WHERE (c.condition_id_norm = '' OR c.condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000')
      AND d.condition_id_norm != ''
    LIMIT 10000000
  `)

  console.log(`  Matches with trade_direction_assignments: ${Number(joinAssignments[0].matches).toLocaleString()}`)
  console.log()

  console.log('═'.repeat(70))
  console.log('STRATEGY')
  console.log('═'.repeat(70))
  console.log()

  const directionMatches = Number(joinDirection[0].matches)
  const assignMatches = Number(joinAssignments[0].matches)

  if (directionMatches > 50000000 || assignMatches > 50000000) {
    console.log('✅ YES! We can enrich most of the 77M trades via JOIN')
    console.log()
    console.log('Recommended approach:')
    console.log('1. Create enriched view by joining vw_trades_canonical with other tables')
    console.log('2. Use COALESCE to fill in missing condition_ids')
    console.log('3. Result: Near 100% coverage with complete trade history')
  } else {
    console.log('⚠️  Limited enrichment possible via JOIN')
    console.log()
    console.log('Alternative approaches:')
    console.log('1. Rebuild from erc1155_transfers + erc20_transfers (blockchain source of truth)')
    console.log('2. Accept 50% coverage and use only validated trades')
    console.log('3. Query missing condition_ids from Polymarket API')
  }
  console.log()
}

canWeEnrich().catch(console.error)
