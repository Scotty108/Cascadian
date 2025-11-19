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

async function ultrathink() {
  console.log('═'.repeat(70))
  console.log('ULTRATHINK: COMPLETE TRADE HISTORY PER WALLET')
  console.log('═'.repeat(70))
  console.log()

  console.log('Goal: Every wallet must have 100% of their trades to calculate accurate metrics')
  console.log()

  // Check 1: vw_trades_canonical - VALID data check
  console.log('1. vw_trades_canonical - Checking for VALID (non-zero) data')
  console.log('-'.repeat(70))

  const canonical = await q(`
    SELECT
      count() as total,
      countDistinct(wallet_address_norm) as unique_wallets,
      countIf(condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as valid_condition_id,
      countIf(market_id_norm != '' AND market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as valid_market_id,
      countIf(wallet_address_norm = '0x00000000000050ba7c429821e6d66429452ba168') as dominant_wallet_count
    FROM vw_trades_canonical
  `)
  const c = canonical[0]
  console.log(`  Total rows: ${Number(c.total).toLocaleString()}`)
  console.log(`  Unique wallets: ${Number(c.unique_wallets).toLocaleString()}`)
  console.log(`  VALID condition_ids: ${Number(c.valid_condition_id).toLocaleString()} (${(Number(c.valid_condition_id)/Number(c.total)*100).toFixed(1)}%)`)
  console.log(`  VALID market_ids: ${Number(c.valid_market_id).toLocaleString()} (${(Number(c.valid_market_id)/Number(c.total)*100).toFixed(1)}%)`)
  console.log(`  Dominant wallet (0x0000...ba168): ${Number(c.dominant_wallet_count).toLocaleString()} (${(Number(c.dominant_wallet_count)/Number(c.total)*100).toFixed(1)}%)`)
  console.log()

  // Check 2: trades_with_direction - VALID data check
  console.log('2. trades_with_direction - Checking for VALID data')
  console.log('-'.repeat(70))

  const direction = await q(`
    SELECT
      count() as total,
      countDistinct(wallet_address) as unique_wallets,
      countIf(condition_id_norm != '') as valid_condition_id,
      countIf(market_id != '' AND market_id != '12' AND market_id != '0x0') as valid_market_id,
      countIf(market_id = '12') as market_id_12,
      countIf(wallet_address = '0x00000000000050ba7c429821e6d66429452ba168') as dominant_wallet_count
    FROM trades_with_direction
  `)
  const d = direction[0]
  console.log(`  Total rows: ${Number(d.total).toLocaleString()}`)
  console.log(`  Unique wallets: ${Number(d.unique_wallets).toLocaleString()}`)
  console.log(`  VALID condition_ids: ${Number(d.valid_condition_id).toLocaleString()} (${(Number(d.valid_condition_id)/Number(d.total)*100).toFixed(1)}%)`)
  console.log(`  VALID market_ids: ${Number(d.valid_market_id).toLocaleString()} (${(Number(d.valid_market_id)/Number(d.total)*100).toFixed(1)}%)`)
  console.log(`  market_id='12': ${Number(d.market_id_12).toLocaleString()} (${(Number(d.market_id_12)/Number(d.total)*100).toFixed(1)}%)`)
  console.log(`  Dominant wallet: ${Number(d.dominant_wallet_count).toLocaleString()} (${(Number(d.dominant_wallet_count)/Number(d.total)*100).toFixed(1)}%)`)
  console.log()

  // Check 3: Check for OVERLAP - are these the SAME trades or DIFFERENT?
  console.log('3. Overlap Analysis - Are these the same trades?')
  console.log('-'.repeat(70))

  // Sample a wallet and check if their trades appear in both tables
  const sampleWallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e' // The top wallet from earlier

  const canonicalTrades = await q(`
    SELECT count() as cnt, countDistinct(transaction_hash) as unique_txs
    FROM vw_trades_canonical
    WHERE wallet_address_norm = '${sampleWallet}'
  `)

  const directionTrades = await q(`
    SELECT count() as cnt, countDistinct(tx_hash) as unique_txs
    FROM trades_with_direction
    WHERE wallet_address = '${sampleWallet}'
  `)

  console.log(`  Sample wallet: ${sampleWallet}`)
  console.log(`  In vw_trades_canonical: ${Number(canonicalTrades[0].cnt).toLocaleString()} trades (${Number(canonicalTrades[0].unique_txs).toLocaleString()} unique tx_hash)`)
  console.log(`  In trades_with_direction: ${Number(directionTrades[0].cnt).toLocaleString()} trades (${Number(directionTrades[0].unique_txs).toLocaleString()} unique tx_hash)`)
  console.log()

  // Check 4: Union coverage - what if we COMBINE all tables?
  console.log('4. CRITICAL: What if we UNION all sources?')
  console.log('-'.repeat(70))

  const unionCoverage = await q(`
    WITH all_tx_hashes AS (
      SELECT DISTINCT transaction_hash as tx FROM vw_trades_canonical WHERE transaction_hash != ''
      UNION DISTINCT
      SELECT DISTINCT tx_hash as tx FROM trades_with_direction WHERE tx_hash != ''
      UNION DISTINCT
      SELECT DISTINCT tx_hash as tx FROM trade_direction_assignments WHERE tx_hash != ''
      UNION DISTINCT
      SELECT DISTINCT transaction_hash as tx FROM trades_raw WHERE transaction_hash != ''
    )
    SELECT count() as total_unique_tx_hashes FROM all_tx_hashes
  `)

  console.log(`  Total UNIQUE tx_hashes across ALL tables: ${Number(unionCoverage[0].total_unique_tx_hashes).toLocaleString()}`)
  console.log()

  // Check 5: Per-wallet completeness check
  console.log('5. Per-Wallet Completeness - Do we have ALL trades for each wallet?')
  console.log('-'.repeat(70))

  // Pick 5 random wallets and check their coverage across tables
  const walletSample = await q(`
    SELECT DISTINCT wallet_address FROM trades_with_direction LIMIT 5
  `)

  console.log('  Checking 5 sample wallets:\n')
  for (const w of walletSample) {
    const wallet = (w as any).wallet_address

    const counts = await q(`
      SELECT
        (SELECT count() FROM vw_trades_canonical WHERE wallet_address_norm = '${wallet}') as canonical,
        (SELECT count() FROM trades_with_direction WHERE wallet_address = '${wallet}') as direction,
        (SELECT count() FROM trade_direction_assignments WHERE wallet_address = '${wallet}') as assignments,
        (SELECT count() FROM trades_raw WHERE wallet_address = '${wallet}') as raw
    `)

    const ct = counts[0]
    console.log(`  ${wallet.substring(0, 20)}...`)
    console.log(`    vw_trades_canonical: ${Number(ct.canonical).toLocaleString()}`)
    console.log(`    trades_with_direction: ${Number(ct.direction).toLocaleString()}`)
    console.log(`    trade_direction_assignments: ${Number(ct.assignments).toLocaleString()}`)
    console.log(`    trades_raw: ${Number(ct.raw).toLocaleString()}`)

    const max = Math.max(Number(ct.canonical), Number(ct.direction), Number(ct.assignments), Number(ct.raw))
    const missing = max - Number(ct.canonical)
    if (missing > 0) {
      console.log(`    ⚠️  vw_trades_canonical is MISSING ${missing} trades (${(missing/max*100).toFixed(1)}% incomplete)`)
    }
    console.log()
  }

  console.log('═'.repeat(70))
  console.log('VERDICT')
  console.log('═'.repeat(70))
  console.log()
  console.log('Key Questions:')
  console.log('1. Does vw_trades_canonical have VALID (non-zero) data?')
  console.log('2. Does any single table have COMPLETE trade history per wallet?')
  console.log('3. Do we need to UNION multiple tables to get 100% coverage?')
  console.log()
}

ultrathink().catch(console.error)
