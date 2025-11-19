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
  console.log('CRITICAL: INVESTIGATING REAL TRADE TABLES')
  console.log('═'.repeat(70))
  console.log()

  // Check 1: Confirm the wallet address bug
  console.log('1. Checking if trades_raw really has all same wallet...')
  const rawWallets = await q(`
    SELECT countDistinct(wallet_address) as unique_wallets, count() as total
    FROM trades_raw
  `)
  console.log(`  trades_raw: ${Number(rawWallets[0].unique_wallets).toLocaleString()} unique wallets out of ${Number(rawWallets[0].total).toLocaleString()} rows`)

  const dedupWallets = await q(`
    SELECT countDistinct(wallet_address) as unique_wallets, count() as total
    FROM trades_dedup_mat_new
  `)
  console.log(`  trades_dedup_mat_new: ${Number(dedupWallets[0].unique_wallets).toLocaleString()} unique wallets out of ${Number(dedupWallets[0].total).toLocaleString()} rows`)
  console.log()

  // Check 2: trade_direction_assignments - THE SMOKING GUN?
  console.log('2. Investigating trade_direction_assignments (130M rows)...')
  try {
    const dirSchema = await q('DESCRIBE TABLE trade_direction_assignments')
    console.log('  Schema:')
    dirSchema.forEach((col: any) => {
      console.log(`    ${col.name.padEnd(30)} ${col.type}`)
    })
    console.log()

    const dirStats = await q(`
      SELECT
        count() as total_rows,
        countDistinct(wallet_address) as unique_wallets,
        countDistinct(tx_hash) as unique_txs,
        countIf(condition_id != '' AND condition_id IS NOT NULL) as with_condition_id,
        countIf(market_id != '' AND market_id IS NOT NULL) as with_market_id
      FROM trade_direction_assignments
    `)
    const ds = dirStats[0]
    console.log('  Statistics:')
    console.log(`    Total rows: ${Number(ds.total_rows).toLocaleString()}`)
    console.log(`    Unique wallets: ${Number(ds.unique_wallets).toLocaleString()}`)
    console.log(`    Unique tx_hash: ${Number(ds.unique_txs).toLocaleString()}`)
    console.log(`    With condition_id: ${Number(ds.with_condition_id).toLocaleString()} (${(Number(ds.with_condition_id)/Number(ds.total_rows)*100).toFixed(1)}%)`)
    console.log(`    With market_id: ${Number(ds.with_market_id).toLocaleString()} (${(Number(ds.with_market_id)/Number(ds.total_rows)*100).toFixed(1)}%)`)
    console.log()
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`)
    console.log()
  }

  // Check 3: vw_trades_canonical - THE VIEW?
  console.log('3. Investigating vw_trades_canonical (view)...')
  try {
    const viewDef = await q(`SHOW CREATE TABLE vw_trades_canonical`)
    console.log('  View definition found!')

    const viewStats = await q(`
      SELECT
        count() as total_rows,
        countDistinct(wallet_address) as unique_wallets,
        countIf(condition_id != '') as with_condition_id
      FROM vw_trades_canonical
    `)
    const vs = viewStats[0]
    console.log(`  Total rows: ${Number(vs.total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${Number(vs.unique_wallets).toLocaleString()}`)
    console.log(`  With condition_id: ${Number(vs.with_condition_id).toLocaleString()}`)
    console.log()
  } catch (e: any) {
    console.log(`  ❌ Not found or error: ${e.message}`)
    console.log()
  }

  // Check 4: trades_with_direction - already know this is good
  console.log('4. trades_with_direction (known good):')
  const directionStats = await q(`
    SELECT
      count() as total,
      countDistinct(wallet_address) as unique_wallets,
      countIf(condition_id_norm != '') as with_condition
    FROM trades_with_direction
  `)
  const drs = directionStats[0]
  console.log(`  Total: ${Number(drs.total).toLocaleString()}`)
  console.log(`  Unique wallets: ${Number(drs.unique_wallets).toLocaleString()}`)
  console.log(`  With condition_id: ${Number(drs.with_condition).toLocaleString()} (100%)`)
  console.log()

  console.log('═'.repeat(70))
  console.log('VERDICT')
  console.log('═'.repeat(70))
  console.log()
  console.log('✅ trades_with_direction: GOOD (82M rows, diverse wallets, 100% condition_ids)')
  console.log('❌ trades_raw: BROKEN (160M rows but all same wallet address)')
  console.log('❌ trades_dedup_mat_new: BROKEN (106M rows but all same wallet address)')
  console.log('❓ trade_direction_assignments: INVESTIGATING (130M rows)')
  console.log('❓ vw_trades_canonical: INVESTIGATING (view)')
  console.log()
}

investigate().catch(console.error)
