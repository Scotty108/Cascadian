#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('🔍 Checking what data we ALREADY have in our DB...\n')

  // Get the "missing" tx_hashes from trades_raw
  console.log('Step 1: Getting sample of "missing" tx_hashes from trades_raw...')
  const missingTxs = await clickhouse.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE (condition_id = '' OR condition_id IS NULL)
      AND transaction_hash != ''
      LIMIT 100000
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const txHashes = JSON.parse(await missingTxs.text()).data.map((r: any) => r.transaction_hash)
  console.log(`  Found ${txHashes.length.toLocaleString()} "missing" tx_hashes\n`)

  // Check trade_direction_assignments
  console.log('Step 2: Checking trade_direction_assignments (129M rows)...')
  const tda = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as found,
        COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id
      FROM trade_direction_assignments
      WHERE tx_hash IN (${txHashes.map(h => `'${h}'`).join(',')})
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const tdaData = JSON.parse(await tda.text()).data[0]
  console.log(`  Found in trade_direction_assignments: ${parseInt(tdaData.found).toLocaleString()}`)
  console.log(`  With condition_id: ${parseInt(tdaData.with_condition_id).toLocaleString()} (${(100 * parseInt(tdaData.with_condition_id) / txHashes.length).toFixed(1)}%)`)
  console.log()

  // Check vw_trades_canonical
  console.log('Step 3: Checking vw_trades_canonical (80M rows)...')
  const vtc = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as found,
        COUNT(CASE WHEN condition_id_norm != '' AND condition_id_norm IS NOT NULL THEN 1 END) as with_condition_id
      FROM vw_trades_canonical
      WHERE tx_hash IN (${txHashes.map(h => `'${h}'`).join(',')})
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const vtcData = JSON.parse(await vtc.text()).data[0]
  console.log(`  Found in vw_trades_canonical: ${parseInt(vtcData.found).toLocaleString()}`)
  console.log(`  With condition_id: ${parseInt(vtcData.with_condition_id).toLocaleString()} (${(100 * parseInt(vtcData.with_condition_id) / txHashes.length).toFixed(1)}%)`)
  console.log()

  // Check erc1155_transfers
  console.log('Step 4: Checking erc1155_transfers (291K rows)...')
  const erc = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT tx_hash) as found
      FROM erc1155_transfers
      WHERE tx_hash IN (${txHashes.map(h => `'${h}'`).join(',')})
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const ercData = JSON.parse(await erc.text()).data[0]
  console.log(`  Found in erc1155_transfers: ${parseInt(ercData.found).toLocaleString()} (${(100 * parseInt(ercData.found) / txHashes.length).toFixed(1)}%)`)
  console.log()

  // VERDICT
  console.log('═'.repeat(80))
  console.log('🚨 VERDICT')
  console.log('═'.repeat(80))

  const totalRecoverable = Math.max(
    parseInt(tdaData.with_condition_id),
    parseInt(vtcData.with_condition_id),
    parseInt(ercData.found)
  )

  const percentRecoverable = (100 * totalRecoverable / txHashes.length).toFixed(1)

  if (parseFloat(percentRecoverable) > 50) {
    console.log(`✅ YOU WERE RIGHT!`)
    console.log(`   ${percentRecoverable}% of "missing" trades can be recovered from EXISTING tables!`)
    console.log(`   No need for ${txHashes.length.toLocaleString()} RPC calls.`)
    console.log()
    console.log('RECOMMENDATION: Use SQL JOINs instead of blockchain backfill')
    console.log(`  Estimated time: 2-5 minutes (vs 19 hours)`)
  } else {
    console.log(`❌ Blockchain backfill IS necessary`)
    console.log(`   Only ${percentRecoverable}% can be recovered from existing tables`)
    console.log(`   Need to fetch ${(txHashes.length * (100 - parseFloat(percentRecoverable)) / 100).toLocaleString()} from blockchain`)
  }

  console.log('═'.repeat(80))
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
