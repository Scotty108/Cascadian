#!/usr/bin/env npx tsx

/**
 * FIX GATE B - Correct CID Normalization
 *
 * Problem: fact_trades_clean uses 66-char CIDs with "0x" prefix
 *          market_resolutions_final uses 64-char CIDs without prefix
 *
 * Solution: Normalize both to same format (66 chars with "0x")
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  clickhouse_settings: {
    send_progress_in_http_headers: 0
  }
})

async function main() {
  console.log('='.repeat(80))
  console.log('GATE B FIX - Correct CID Normalization')
  console.log('='.repeat(80))

  // Step 1: Create corrected _res_cid view
  console.log('\n[1/3] Creating corrected _res_cid view...')
  console.log('  Old formula: concat("0x", lpad(replaceOne(lower(condition_id_norm),"0x",""),64,"0"))')
  console.log('  New formula: concat("0x", lower(replaceAll(condition_id_norm, "0x", "")))')

  await client.command({
    query: `
      CREATE OR REPLACE VIEW _res_cid AS
      SELECT DISTINCT concat('0x', lower(replaceAll(condition_id_norm, '0x', ''))) AS cid
      FROM market_resolutions_final
      WHERE condition_id_norm != '' AND length(condition_id_norm) > 0
    `
  })
  console.log('  ✅ View recreated with corrected normalization')

  // Step 2: Count resolution CIDs
  console.log('\n[2/3] Counting resolution CIDs...')
  const resCount = await client.query({
    query: 'SELECT count() as count FROM _res_cid',
    format: 'JSONEachRow'
  })
  const resCountResult = await resCount.json<{ count: string }>()
  console.log(`  ✅ Resolution CIDs: ${parseInt(resCountResult[0].count).toLocaleString()}`)

  // Step 3: Recompute Gate B
  console.log('\n[3/3] Recomputing Gate B with corrected normalization...')
  const gateB = await client.query({
    query: `
      WITH res AS (
        SELECT cid FROM _res_cid
      ),
      fact AS (
        SELECT DISTINCT cid FROM fact_trades_clean
      )
      SELECT
        (SELECT count() FROM res) AS res_cids,
        (SELECT count() FROM fact) AS fact_cids,
        (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact)) AS overlap_cids,
        round(100.0 * overlap_cids / nullIf(res_cids, 0), 2) AS pct_res_covered_by_fact
      FROM res
      LIMIT 1
    `,
    format: 'JSONEachRow'
  })

  const gateBResult = await gateB.json<{
    res_cids: string
    fact_cids: string
    overlap_cids: string
    pct_res_covered_by_fact: string
  }>()

  const gateBPct = parseFloat(gateBResult[0].pct_res_covered_by_fact)
  const gateBPassed = gateBPct >= 85.0

  console.log('\n' + '='.repeat(80))
  console.log('GATE B RESULTS (After Normalization Fix)')
  console.log('='.repeat(80))
  console.log(`Total resolution CIDs:     ${parseInt(gateBResult[0].res_cids).toLocaleString()}`)
  console.log(`CIDs in fact_trades_clean: ${parseInt(gateBResult[0].fact_cids).toLocaleString()}`)
  console.log(`Resolution CIDs covered:   ${parseInt(gateBResult[0].overlap_cids).toLocaleString()}`)
  console.log(`\nGate B Coverage:           ${gateBPct.toFixed(2)}%`)
  console.log(`Gate B Status:             ${gateBPassed ? '✅ PASSED' : '❌ FAILED'} (≥85% required)`)

  if (gateBPassed) {
    console.log(`\n🎉 SUCCESS! Gate B now passes with ${gateBPct.toFixed(2)}% coverage!`)
    console.log(`\nThe issue was CID format mismatch:`)
    console.log(`  - fact_trades_clean:        66-char with "0x" prefix`)
    console.log(`  - market_resolutions_final: 64-char without prefix`)
    console.log(`\nFix: Normalized both to 66-char format with "0x" prefix`)
  } else {
    const missing = parseInt(gateBResult[0].res_cids) - parseInt(gateBResult[0].overlap_cids)
    console.log(`\n⚠️  Gate B still below target.`)
    console.log(`   Missing: ${missing.toLocaleString()} CIDs (${(100 - gateBPct).toFixed(2)}%)`)
    console.log(`\nNormalization fix alone was insufficient. Next steps:`)
    console.log(`   1. Investigate remaining ${missing.toLocaleString()} missing CIDs`)
    console.log(`   2. Consider API-based backfill from Polymarket CLOB`)
    console.log(`   3. Review market_resolutions_final completeness`)
  }

  await client.close()
}

main().catch(console.error)
