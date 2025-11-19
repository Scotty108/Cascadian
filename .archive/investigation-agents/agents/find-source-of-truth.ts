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

async function findSourceOfTruth() {
  console.log('═'.repeat(70))
  console.log('FINDING THE SOURCE OF TRUTH')
  console.log('═'.repeat(70))
  console.log()

  // Strategy: Pick 10 random wallets and check which table has the most trades for each
  const wallets = await q(`
    SELECT DISTINCT wallet_address
    FROM trades_with_direction
    LIMIT 10
  `)

  console.log('Checking 10 wallets across all tables...\n')

  let canonicalWins = 0
  let directionWins = 0
  let assignmentsWins = 0
  let rawWins = 0

  for (const w of wallets) {
    const wallet = (w as any).wallet_address

    const counts = await q(`
      SELECT
        (SELECT count() FROM vw_trades_canonical WHERE wallet_address_norm = '${wallet}') as canonical,
        (SELECT count() FROM trades_with_direction WHERE wallet_address = '${wallet}') as direction,
        (SELECT count() FROM trade_direction_assignments WHERE wallet_address = '${wallet}') as assignments,
        (SELECT count() FROM trades_raw WHERE wallet_address = '${wallet}') as raw
    `)

    const ct = counts[0]
    const canon = Number(ct.canonical)
    const dir = Number(ct.direction)
    const assign = Number(ct.assignments)
    const raw = Number(ct.raw)

    console.log(`${wallet.substring(0, 20)}...`)
    console.log(`  vw_trades_canonical: ${canon.toLocaleString()}`)
    console.log(`  trades_with_direction: ${dir.toLocaleString()}`)
    console.log(`  trade_direction_assignments: ${assign.toLocaleString()}`)
    console.log(`  trades_raw: ${raw.toLocaleString()}`)

    const max = Math.max(canon, dir, assign, raw)
    if (canon === max) {
      console.log(`  ✅ vw_trades_canonical has the most`)
      canonicalWins++
    } else if (dir === max) {
      console.log(`  ✅ trades_with_direction has the most`)
      directionWins++
    } else if (assign === max) {
      console.log(`  ✅ trade_direction_assignments has the most`)
      assignmentsWins++
    } else {
      console.log(`  ✅ trades_raw has the most`)
      rawWins++
    }
    console.log()
  }

  console.log('═'.repeat(70))
  console.log('RESULTS')
  console.log('═'.repeat(70))
  console.log(`vw_trades_canonical won: ${canonicalWins}/10`)
  console.log(`trades_with_direction won: ${directionWins}/10`)
  console.log(`trade_direction_assignments won: ${assignmentsWins}/10`)
  console.log(`trades_raw won: ${rawWins}/10`)
  console.log()

  if (canonicalWins >= 7) {
    console.log('✅ vw_trades_canonical has the most complete coverage')
    console.log('   BUT needs filtering for VALID condition_ids/market_ids')
  } else if (assignmentsWins >= 7) {
    console.log('✅ trade_direction_assignments has the most complete coverage')
    console.log('   BUT only 50% have condition_ids - needs enrichment')
  } else if (rawWins >= 7) {
    console.log('✅ trades_raw has the most complete coverage')
    console.log('   BUT only 51% have condition_ids - needs enrichment')
  } else {
    console.log('⚠️  NO SINGLE TABLE HAS COMPLETE COVERAGE')
    console.log('   Need to UNION multiple tables or rebuild from blockchain')
  }
  console.log()
}

findSourceOfTruth().catch(console.error)
