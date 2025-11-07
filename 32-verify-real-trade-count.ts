#!/usr/bin/env npx tsx

/**
 * VERIFY ACTUAL TRADE COUNTS - Emergency Check
 *
 * The Polymarket UI shows Wallet 2 has 2,590 predictions.
 * But my queries only found 2 trades.
 * This is WRONG. Let's find the real data.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', name: 'Wallet 1', uiPredictions: 1 },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2', uiPredictions: 2590 },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3', uiPredictions: null },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4', uiPredictions: null },
]

async function main() {
  console.log('='.repeat(100))
  console.log('VERIFY ACTUAL TRADE COUNTS')
  console.log('='.repeat(100))

  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n${wallet.name}: ${wallet.addr}`)
    console.log('='.repeat(100))

    // Check with lowercase
    const result1 = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as total_trades,
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition_ids,
          SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as non_empty_condition_ids,
          COUNT(DISTINCT condition_id) as unique_conditions
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.addr}')
        GROUP BY wallet_address
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    console.log(`\nWith lowercase matching:`)
    if (result1.length > 0) {
      const r = result1[0]
      console.log(`  Total trades: ${r.total_trades}`)
      console.log(`  Empty condition_ids: ${r.empty_condition_ids}`)
      console.log(`  Non-empty condition_ids: ${r.non_empty_condition_ids}`)
      console.log(`  Unique conditions: ${r.unique_conditions}`)
      if (wallet.uiPredictions) {
        console.log(`  UI shows: ${wallet.uiPredictions} predictions`)
        console.log(`  Gap: ${wallet.uiPredictions - r.total_trades} missing trades`)
      }
    } else {
      console.log(`  NO MATCHES with lowercase`)
    }

    // Check with exact case (checksummed)
    const result2 = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as total_trades
        FROM trades_raw
        WHERE wallet_address = '${wallet.addr}'
        GROUP BY wallet_address
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    console.log(`\nWith exact address matching:`)
    if (result2.length > 0) {
      console.log(`  Total trades: ${result2[0].total_trades}`)
    } else {
      console.log(`  NO MATCHES with exact address`)
    }

    // Check variations
    const result3 = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as count
        FROM trades_raw
        WHERE wallet_address ILIKE '%${wallet.addr.substring(2)}%'
        GROUP BY wallet_address
        LIMIT 5
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    console.log(`\nVariations of this address in database:`)
    if (result3.length > 0) {
      for (const r of result3) {
        console.log(`  ${r.wallet_address}: ${r.count} trades`)
      }
    } else {
      console.log(`  No variations found`)
    }
  }

  // Check overall empty condition_ids across ALL trades
  console.log('\n\n' + '='.repeat(100))
  console.log('OVERALL EMPTY CONDITION_ID ANALYSIS')
  console.log('='.repeat(100))

  const overall = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition_ids,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_empty,
        COUNT(DISTINCT wallet_address) as total_wallets
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const o = overall[0]
  console.log(`\nTotal trades: ${o.total_trades}`)
  console.log(`Empty condition_ids: ${o.empty_condition_ids} (${o.pct_empty.toFixed(2)}%)`)
  console.log(`Wallets affected: ${o.total_wallets}`)

  // Check if erc1155_transfers table exists and has data
  console.log('\n\n' + '='.repeat(100))
  console.log('ERC1155_TRANSFERS TABLE CHECK')
  console.log('='.repeat(100))

  try {
    const erc1155 = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT tx_hash) as unique_tx_hashes,
          COUNT(DISTINCT from_address) as unique_from_addresses
        FROM erc1155_transfers
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    if (erc1155.length > 0) {
      console.log(`\n✅ erc1155_transfers table exists`)
      console.log(`  Total rows: ${erc1155[0].total_rows}`)
      console.log(`  Unique tx_hashes: ${erc1155[0].unique_tx_hashes}`)
      console.log(`  Can use for recovery: YES`)
    }
  } catch (e) {
    console.log(`\n❌ erc1155_transfers table not found or error`)
  }
}

main().catch(e => console.error('Error:', e))
