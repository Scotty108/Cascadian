#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function verify() {
  console.log('\n' + '='.repeat(120))
  console.log('VERIFY: Can we fill 77.4M missing condition_ids from existing ERC1155 data?')
  console.log('='.repeat(120))
  
  // Step 1: Test JOIN on sample of missing condition_ids
  console.log('\n📋 STEP 1: Test JOIN - Sample of 1000 trades with missing condition_id')
  
  const sampleJoinResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as tested_trades,
        SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) as found_in_erc1155,
        ROUND(100.0 * SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as match_pct
      FROM (
        SELECT DISTINCT t.transaction_hash, t.timestamp
        FROM trades_raw t
        WHERE (t.condition_id = '' OR t.condition_id IS NULL)
        LIMIT 1000
      ) t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
    `,
    format: 'JSONEachRow'
  })
  
  const sampleData = await sampleJoinResult.json()
  const sample = sampleData[0]
  
  console.log(`  Tested: ${sample.tested_trades.toLocaleString()} trades with missing condition_id`)
  console.log(`  Found in ERC1155: ${sample.found_in_erc1155.toLocaleString()}`)
  console.log(`  Match rate: ${sample.match_pct}%`)
  
  // Step 2: Extract condition_id from token_id
  console.log('\n📋 STEP 2: Extract condition_id from token_id')
  console.log('  Formula: condition_id = token_id >> 8 (bitwise right shift)')
  
  const extractResult = await clickhouse.query({
    query: `
      SELECT
        t.transaction_hash,
        e.tx_hash,
        e.token_ids[1] as first_token_id,
        CAST(bitShiftRight(CAST(CAST(e.token_ids[1] AS String) AS Int256), 8) AS String) as extracted_condition_id,
        LENGTH(CAST(bitShiftRight(CAST(CAST(e.token_ids[1] AS String) AS Int256), 8) AS String)) as condition_id_length
      FROM (
        SELECT DISTINCT t.transaction_hash
        FROM trades_raw t
        WHERE (t.condition_id = '' OR t.condition_id IS NULL)
        LIMIT 10
      ) t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE e.tx_hash IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  
  const extractData = await extractResult.json()
  if (extractData.length > 0) {
    console.log(`  Sample extractions:`)
    for (const row of extractData) {
      console.log(`    token_id: ${row.first_token_id} → condition_id: ${row.extracted_condition_id} (len: ${row.condition_id_length})`)
    }
  }
  
  // Step 3: Full coverage analysis
  console.log('\n📋 STEP 3: Estimate coverage of all 77.4M')
  
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_missing,
        SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) as can_recover,
        ROUND(100.0 * SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as recovery_rate
      FROM trades_raw t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE t.condition_id = '' OR t.condition_id IS NULL
    `,
    format: 'JSONEachRow'
  })
  
  const coverageData = await coverageResult.json()
  const coverage = coverageData[0]
  
  console.log(`\n  Total trades with missing condition_id: ${coverage.total_missing.toLocaleString()}`)
  console.log(`  Can be recovered from ERC1155: ${coverage.can_recover.toLocaleString()}`)
  console.log(`  Recovery rate: ${coverage.recovery_rate}%`)
  
  const remaining = Number(coverage.total_missing) - Number(coverage.can_recover)
  console.log(`  Will still be missing: ${remaining.toLocaleString()}`)
  
  console.log('\n' + '='.repeat(120))
  console.log('VERDICT')
  console.log('='.repeat(120))
  
  if (coverage.recovery_rate > 50) {
    console.log(`\n✅ YES - We can fill ${coverage.recovery_rate}% of the 77.4M missing condition_ids`)
    console.log(`\nPlan:`)
    console.log(`  1. JOIN trades_raw with erc1155_transfers by tx_hash`)
    console.log(`  2. Extract condition_id = token_id >> 8`)
    console.log(`  3. Update trades_raw.condition_id (1-2 hours)`)
    console.log(`  4. Recover ${coverage.can_recover.toLocaleString()} condition_ids`)
  } else {
    console.log(`\n⚠️ LOW RECOVERY: Only ${coverage.recovery_rate}% match by tx_hash`)
    console.log(`   Need different matching strategy`)
  }
}

verify().catch(e => console.error('Error:', (e as Error).message))
