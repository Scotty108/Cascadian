#!/usr/bin/env npx tsx

/**
 * GATE B RECOVERY - STEP 4: Verify Gates A & B
 *
 * Recomputes both gates to verify recovery success:
 * - Gate A: Transaction coverage (missing tx_hashes covered in fact_trades_clean)
 * - Gate B: Condition ID coverage (resolution CIDs covered in fact_trades_clean)
 *
 * Success criteria:
 * - Gate A: ≥99% (already passing)
 * - Gate B: ≥85% (target of this recovery)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function verifyGates() {
  console.log('='.repeat(100))
  console.log('GATE B RECOVERY - STEP 4: Verify Gates A & B')
  console.log('='.repeat(100))

  try {
    // Gate A: Transaction Coverage
    console.log('\n[Gate A] Transaction Coverage Analysis')
    console.log('─'.repeat(100))

    const gateAResult = await clickhouse.query({
      query: `
        WITH missing AS (
          SELECT DISTINCT transaction_hash AS tx
          FROM trades_raw
          WHERE (condition_id = '' OR condition_id = concat('0x', repeat('0',64)))
            AND transaction_hash != ''
        ),
        covered AS (
          SELECT DISTINCT tx_hash AS tx FROM fact_trades_clean
        )
        SELECT
          count() AS missing_cnt,
          countIf(tx IN (SELECT tx FROM covered)) AS covered_cnt,
          round(100.0 * covered_cnt / nullIf(missing_cnt, 0), 2) AS pct_in_union_for_missing
        FROM missing
      `,
      format: 'JSONEachRow'
    })

    const gateA = await gateAResult.json<{
      missing_cnt: string
      covered_cnt: string
      pct_in_union_for_missing: string
    }>()

    const gateAPct = parseFloat(gateA[0].pct_in_union_for_missing)
    const gateAPassed = gateAPct >= 99.0

    console.log(`Missing transactions (empty/zero CID): ${parseInt(gateA[0].missing_cnt).toLocaleString()}`)
    console.log(`Covered in fact_trades_clean:          ${parseInt(gateA[0].covered_cnt).toLocaleString()}`)
    console.log(`Coverage percentage:                   ${gateAPct.toFixed(2)}%`)
    console.log(`Gate A status:                         ${gateAPassed ? '✅ PASSED' : '❌ FAILED'} (≥99% required)`)

    // Gate B: Condition ID Coverage
    console.log('\n[Gate B] Condition ID Coverage Analysis')
    console.log('─'.repeat(100))

    const gateBResult = await clickhouse.query({
      query: `
        WITH res AS (
          SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid
          FROM market_resolutions_final
          WHERE condition_id_norm != ''
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

    const gateB = await gateBResult.json<{
      res_cids: string
      fact_cids: string
      overlap_cids: string
      pct_res_covered_by_fact: string
    }>()

    const gateBPct = parseFloat(gateB[0].pct_res_covered_by_fact)
    const gateBPassed = gateBPct >= 85.0

    console.log(`Total resolution CIDs:                 ${parseInt(gateB[0].res_cids).toLocaleString()}`)
    console.log(`CIDs in fact_trades_clean:             ${parseInt(gateB[0].fact_cids).toLocaleString()}`)
    console.log(`Resolution CIDs covered:               ${parseInt(gateB[0].overlap_cids).toLocaleString()}`)
    console.log(`Coverage percentage:                   ${gateBPct.toFixed(2)}%`)
    console.log(`Gate B status:                         ${gateBPassed ? '✅ PASSED' : '❌ FAILED'} (≥85% required)`)

    // Additional Analytics
    console.log('\n[Additional Analytics] Top 10 CIDs by New Transaction Count')
    console.log('─'.repeat(100))

    const topNewCids = await clickhouse.query({
      query: `
        SELECT
          cid,
          count() as new_tx_count
        FROM repair_pairs_temp
        GROUP BY cid
        ORDER BY new_tx_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })

    const topNewCidsResult = await topNewCids.json<{ cid: string; new_tx_count: string }>()
    if (topNewCidsResult.length > 0) {
      topNewCidsResult.forEach((row, i) => {
        console.log(`${i + 1}. ${row.cid}: ${parseInt(row.new_tx_count).toLocaleString()} new transactions`)
      })
    } else {
      console.log('No new transactions found (repair_pairs_temp may be empty)')
    }

    // Contract addresses that produced hits
    console.log('\n[Additional Analytics] Contract Addresses That Produced Hits')
    console.log('─'.repeat(100))

    const contractHits = await clickhouse.query({
      query: `
        SELECT DISTINCT
          e.contract_address AS addr,
          count(DISTINCT rp.tx_hash) AS hit_count
        FROM repair_pairs_temp rp
        JOIN erc1155_transfers e ON e.tx_hash = rp.tx_hash
        GROUP BY addr
        ORDER BY hit_count DESC
      `,
      format: 'JSONEachRow'
    })

    const contractHitsResult = await contractHits.json<{ addr: string; hit_count: string }>()
    if (contractHitsResult.length > 0) {
      contractHitsResult.forEach((row, i) => {
        const isCTFExchange = row.addr.toLowerCase() === '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
        const label = isCTFExchange ? ' (CTF Exchange - known)' : ' (discovered)'
        console.log(`${i + 1}. ${row.addr}: ${parseInt(row.hit_count).toLocaleString()} hits${label}`)
      })
    } else {
      console.log('No contract hits found')
    }

    // Final Summary
    console.log('\n' + '='.repeat(100))
    console.log('GATE VERIFICATION COMPLETE - Final Summary:')
    console.log('='.repeat(100))
    console.log(`Gate A (TX Coverage):  ${gateAPct.toFixed(2)}% ${gateAPassed ? '✅ PASSED' : '❌ FAILED'}`)
    console.log(`Gate B (CID Coverage): ${gateBPct.toFixed(2)}% ${gateBPassed ? '✅ PASSED' : '❌ FAILED'}`)

    if (gateAPassed && gateBPassed) {
      console.log(`\n🎉 SUCCESS! Both gates passed. fact_trades_clean is ready for production.`)
    } else if (gateBPassed) {
      console.log(`\n✅ Gate B passed! Recovery successful.`)
      if (!gateAPassed) {
        console.log(`⚠️  Gate A still failing. Investigate transaction coverage.`)
      }
    } else {
      console.log(`\n⚠️  Gate B still below 85%. Consider:`)
      console.log(`   1. Running additional blockchain backfill for more block ranges`)
      console.log(`   2. Checking if candidate_ctf_addresses missed some contracts`)
      console.log(`   3. Verifying repair_pairs_temp was properly populated`)
    }

    // Cleanup suggestion
    if (gateBPassed) {
      console.log(`\n💡 Cleanup: You can now drop temporary objects:`)
      console.log(`   DROP VIEW _res_cid;`)
      console.log(`   DROP VIEW _fact_cid;`)
      console.log(`   DROP VIEW _still_missing_cids;`)
      console.log(`   DROP VIEW _candidate_ctf_addresses;`)
      console.log(`   DROP TABLE repair_pairs_temp;`)
    }

  } catch (error) {
    console.error('❌ Verification error:', error)
    throw error
  }
}

verifyGates().catch(console.error)
