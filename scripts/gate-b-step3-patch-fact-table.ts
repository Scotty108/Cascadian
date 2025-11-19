#!/usr/bin/env npx tsx

/**
 * GATE B RECOVERY - STEP 3: Patch fact_trades_clean
 *
 * Uses repair_pairs_temp to patch fact_trades_clean with missing condition IDs.
 *
 * Two-phase approach:
 * 1. Primary patch from vw_trades_canonical (high-quality data with full fields)
 * 2. Fallback patch from trade_direction_assignments (when canonical not available)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function patchFactTable() {
  console.log('='.repeat(100))
  console.log('GATE B RECOVERY - STEP 3: Patch fact_trades_clean')
  console.log('='.repeat(100))

  try {
    // Verify repair_pairs_temp has data
    console.log('\n[1/4] Verifying repair_pairs_temp...')
    const repairCount = await clickhouse.query({
      query: 'SELECT count() as count FROM repair_pairs_temp',
      format: 'JSONEachRow'
    })
    const repairCountResult = await repairCount.json<{ count: string }>()
    const totalRepairPairs = parseInt(repairCountResult[0].count)

    if (totalRepairPairs === 0) {
      console.log('⚠️  No repair pairs found. Nothing to patch.')
      return
    }

    console.log(`✅ Found ${totalRepairPairs.toLocaleString()} repair pairs`)

    // Check fact_trades_clean before
    console.log('\n[2/4] Getting baseline stats...')
    const beforeCount = await clickhouse.query({
      query: 'SELECT count() as count FROM fact_trades_clean',
      format: 'JSONEachRow'
    })
    const beforeCountResult = await beforeCount.json<{ count: string }>()
    const rowsBefore = parseInt(beforeCountResult[0].count)
    console.log(`Current fact_trades_clean rows: ${rowsBefore.toLocaleString()}`)

    // Primary patch from vw_trades_canonical
    console.log('\n[3/4] Phase 1: Patching from vw_trades_canonical...')
    const phase1Start = Date.now()

    await clickhouse.command({
      query: `
        INSERT INTO fact_trades_clean
        SELECT
          v.transaction_hash AS tx_hash,
          v.timestamp AS block_time,
          rp.cid AS cid,
          v.outcome_index AS outcome_index,
          v.wallet_address_norm AS wallet_address,
          v.trade_direction AS direction,
          v.shares,
          v.entry_price AS price,
          v.usd_value AS usdc_amount
        FROM repair_pairs_temp rp
        JOIN vw_trades_canonical v ON v.transaction_hash = rp.tx_hash
        LEFT JOIN fact_trades_clean f ON f.tx_hash = v.transaction_hash AND f.cid = rp.cid
        WHERE f.tx_hash IS NULL
      `
    })

    const phase1Elapsed = ((Date.now() - phase1Start) / 1000).toFixed(1)
    console.log(`✅ Phase 1 complete in ${phase1Elapsed}s`)

    // Check intermediate count
    const afterPhase1Count = await clickhouse.query({
      query: 'SELECT count() as count FROM fact_trades_clean',
      format: 'JSONEachRow'
    })
    const afterPhase1Result = await afterPhase1Count.json<{ count: string }>()
    const rowsAfterPhase1 = parseInt(afterPhase1Result[0].count)
    const phase1Inserted = rowsAfterPhase1 - rowsBefore
    console.log(`Inserted from canonical: ${phase1Inserted.toLocaleString()} rows`)

    // Fallback patch from trade_direction_assignments
    console.log('\n[4/4] Phase 2: Fallback patching from trade_direction_assignments...')
    const phase2Start = Date.now()

    await clickhouse.command({
      query: `
        INSERT INTO fact_trades_clean
        SELECT
          rp.tx_hash,
          tda.created_at AS block_time,
          rp.cid AS cid,
          0 AS outcome_index,
          tda.wallet_address AS wallet_address,
          tda.direction AS direction,
          toDecimal64(tda.tokens_in, 18) AS shares,
          toDecimal64(0, 6) AS price,
          toDecimal64(tda.usdc_out - tda.usdc_in, 6) AS usdc_amount
        FROM repair_pairs_temp rp
        LEFT JOIN fact_trades_clean f ON f.tx_hash = rp.tx_hash AND f.cid = rp.cid
        LEFT JOIN vw_trades_canonical v ON v.transaction_hash = rp.tx_hash
        JOIN trade_direction_assignments tda ON tda.tx_hash = rp.tx_hash
        WHERE f.tx_hash IS NULL AND v.transaction_hash IS NULL
      `
    })

    const phase2Elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1)
    console.log(`✅ Phase 2 complete in ${phase2Elapsed}s`)

    // Final count
    const afterPhase2Count = await clickhouse.query({
      query: 'SELECT count() as count FROM fact_trades_clean',
      format: 'JSONEachRow'
    })
    const afterPhase2Result = await afterPhase2Count.json<{ count: string }>()
    const rowsAfterPhase2 = parseInt(afterPhase2Result[0].count)
    const phase2Inserted = rowsAfterPhase2 - rowsAfterPhase1
    const totalInserted = rowsAfterPhase2 - rowsBefore

    // Summary
    console.log('\n' + '='.repeat(100))
    console.log('PATCHING COMPLETE - Summary:')
    console.log('='.repeat(100))
    console.log(`Rows before:                ${rowsBefore.toLocaleString()}`)
    console.log(`Rows after:                 ${rowsAfterPhase2.toLocaleString()}`)
    console.log(`Total inserted:             ${totalInserted.toLocaleString()}`)
    console.log(`  - From canonical:         ${phase1Inserted.toLocaleString()}`)
    console.log(`  - From direction assigns: ${phase2Inserted.toLocaleString()}`)
    console.log(`\nNext: Run gate-b-step4-verify-gates.ts to check Gate B coverage`)

  } catch (error) {
    console.error('❌ Patching error:', error)
    throw error
  }
}

patchFactTable().catch(console.error)
