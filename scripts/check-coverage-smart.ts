#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('🔍 Checking what % of missing trades we already have...\n')

  // Strategy: Use JOINs instead of IN clauses
  console.log('Checking trade_direction_assignments (129M rows)...')
  const tda = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.transaction_hash) as total_missing,
        COUNT(DISTINCT CASE WHEN tda.condition_id != '' THEN t.transaction_hash END) as found_with_condition_id
      FROM (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
        AND transaction_hash != ''
        LIMIT 500000
      ) t
      LEFT JOIN trade_direction_assignments tda
        ON t.transaction_hash = tda.tx_hash
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const tdaData = JSON.parse(await tda.text()).data[0]
  const tdaCoverage = (100 * parseInt(tdaData.found_with_condition_id) / parseInt(tdaData.total_missing)).toFixed(1)
  console.log(`  Coverage: ${tdaCoverage}% (${parseInt(tdaData.found_with_condition_id).toLocaleString()} / ${parseInt(tdaData.total_missing).toLocaleString()})`)
  console.log()

  console.log('Checking vw_trades_canonical (80M rows)...')
  const vtc = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.transaction_hash) as total_missing,
        COUNT(DISTINCT CASE WHEN v.condition_id_norm != '' THEN t.transaction_hash END) as found_with_condition_id
      FROM (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
        AND transaction_hash != ''
        LIMIT 500000
      ) t
      LEFT JOIN vw_trades_canonical v
        ON t.transaction_hash = v.tx_hash
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const vtcData = JSON.parse(await vtc.text()).data[0]
  const vtcCoverage = (100 * parseInt(vtcData.found_with_condition_id) / parseInt(vtcData.total_missing)).toFixed(1)
  console.log(`  Coverage: ${vtcCoverage}% (${parseInt(vtcData.found_with_condition_id).toLocaleString()} / ${parseInt(vtcData.total_missing).toLocaleString()})`)
  console.log()

  // Check combined coverage
  console.log('Checking COMBINED coverage (trade_direction_assignments OR vw_trades_canonical)...')
  const combined = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.transaction_hash) as total_missing,
        COUNT(DISTINCT CASE
          WHEN tda.condition_id != '' OR v.condition_id_norm != ''
          THEN t.transaction_hash
        END) as found_with_condition_id
      FROM (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
        AND transaction_hash != ''
        LIMIT 500000
      ) t
      LEFT JOIN trade_direction_assignments tda ON t.transaction_hash = tda.tx_hash
      LEFT JOIN vw_trades_canonical v ON t.transaction_hash = v.tx_hash
    `,
    clickhouse_settings: { send_progress_in_http_headers: 0 }
  })

  const combinedData = JSON.parse(await combined.text()).data[0]
  const combinedCoverage = (100 * parseInt(combinedData.found_with_condition_id) / parseInt(combinedData.total_missing)).toFixed(1)
  console.log(`  COMBINED Coverage: ${combinedCoverage}% (${parseInt(combinedData.found_with_condition_id).toLocaleString()} / ${parseInt(combinedData.total_missing).toLocaleString()})`)
  console.log()

  // VERDICT
  console.log('═'.repeat(80))
  console.log('🚨 VERDICT')
  console.log('═'.repeat(80))

  if (parseFloat(combinedCoverage) > 80) {
    console.log(`✅ YOU WERE 100% RIGHT!`)
    console.log(`   ${combinedCoverage}% of "missing" trades can be recovered from EXISTING tables!`)
    console.log()
    console.log('KILL THE BACKFILL - Use SQL JOINs instead:')
    console.log('  Time: 2-5 minutes (vs 19 hours)')
    console.log('  Method: JOIN trades_raw with trade_direction_assignments + vw_trades_canonical')
  } else if (parseFloat(combinedCoverage) > 50) {
    console.log(`⚠️  HYBRID APPROACH`)
    console.log(`   ${combinedCoverage}% can be recovered from existing tables`)
    console.log(`   ${(100 - parseFloat(combinedCoverage)).toFixed(1)}% still needs blockchain fetch`)
    console.log()
    console.log('RECOMMENDATION:')
    console.log('  1. Quick SQL recovery for the ${combinedCoverage}%')
    console.log(`  2. Blockchain backfill for remaining ${(100 - parseFloat(combinedCoverage)).toFixed(1)}%`)
  } else {
    console.log(`❌ Blockchain backfill IS necessary`)
    console.log(`   Only ${combinedCoverage}% recoverable from existing tables`)
    console.log(`   Need blockchain fetch for ${(100 - parseFloat(combinedCoverage)).toFixed(1)}%`)
  }

  console.log('═'.repeat(80))
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
