#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function extract() {
  console.log('\n' + '='.repeat(120))
  console.log('EXTRACT: Can we fill 77.4M condition_ids from ERC1155 token_id?')
  console.log('='.repeat(120))
  
  console.log('\n✓ Sample token_id extraction:')
  
  // Manual JS extraction to understand the format
  const sampleTokenIds = [
    '0x4c211e0df646c6cd0d48236bf2707b29728c40010559288a74b739ca14907134',
    '0x9e18d73dadb0c832438ce1078eb2a16514d14a2c5b9355dbdb794cf4a32d7a32'
  ]
  
  for (const tokenId of sampleTokenIds) {
    const num = BigInt(tokenId)
    const conditionId = num >> 8n  // Right shift 8 bits
    const outcomeIdx = num & 0xFFn  // Last 8 bits
    
    console.log(`\n  token_id: ${tokenId}`)
    console.log(`  → condition_id: ${conditionId.toString().padStart(64, '0')}`)
    console.log(`  → outcome_index: ${outcomeIdx}`)
  }
  
  // Now test the JOIN and extraction on real data
  console.log('\n' + '='.repeat(120))
  console.log('Test: Match 77.4M missing trades to ERC1155 and extract condition_id')
  console.log('='.repeat(120))
  
  const testResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_missing_trades,
        SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) as matched_in_erc1155,
        ROUND(100.0 * SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as match_rate
      FROM trades_raw t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE (t.condition_id = '' OR t.condition_id IS NULL)
        AND t.timestamp >= '2024-07-01'
    `,
    format: 'JSONEachRow'
  })
  
  const testData = await testResult.json()
  const test = testData[0]
  
  console.log(`\nTest on trades from Jul 2024 onwards (where ERC1155 data exists):`)
  console.log(`  Total trades with missing condition_id: ${test.total_missing_trades.toLocaleString()}`)
  console.log(`  Matched in ERC1155 transfers: ${test.matched_in_erc1155.toLocaleString()}`)
  console.log(`  Match rate: ${test.match_rate}%`)
  
  if (Number(test.match_rate) > 50) {
    console.log(`\n✅ YES - We can fill ${test.match_rate}% of missing condition_ids!`)
    console.log(`\n🎯 PLAN:`)
    console.log(`  1. UPDATE trades_raw SET condition_id = extracted_from_token_id`)
    console.log(`  2. Extract condition_id by right-shifting token_id 8 bits`)
    console.log(`  3. Recover: ${test.matched_in_erc1155.toLocaleString()} condition_ids`)
    console.log(`  4. Timeline: 1-2 hours for atomic UPDATE`)
    process.exit(0)
  } else {
    console.log(`\n❌ Low match rate - need different approach`)
    process.exit(1)
  }
}

extract().catch(e => console.error('Error:', (e as Error).message))
