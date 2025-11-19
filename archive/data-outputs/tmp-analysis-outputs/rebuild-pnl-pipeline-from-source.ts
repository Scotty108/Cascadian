#!/usr/bin/env npx tsx
/**
 * REBUILD P&L PIPELINE FROM SOURCE OF TRUTH
 *
 * Fixes JOIN fan-out by rebuilding entire pipeline from vw_clob_fills_enriched
 *
 * Pipeline:
 * 1. trade_cashflows_v3 (FROM vw_clob_fills_enriched)
 * 2. outcome_positions_v2 (FROM trade_cashflows_v3)
 * 3. realized_pnl_by_market_final (FROM outcome_positions_v2 + trade_cashflows_v3 + winning_index)
 *
 * Validation checkpoints at each stage
 * Phantom condition: 03f1de7c... should have 5 wallets (not 12)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

interface Checkpoint {
  stage: string
  timestamp: string
  duration_seconds: number
  rows_created?: number
  validation_passed: boolean
  notes: string[]
}

const checkpoints: Checkpoint[] = []

function logCheckpoint(cp: Checkpoint) {
  checkpoints.push(cp)
  console.log(`\n✅ CHECKPOINT: ${cp.stage}`)
  console.log(`   Duration: ${cp.duration_seconds}s`)
  if (cp.rows_created) console.log(`   Rows: ${cp.rows_created.toLocaleString()}`)
  console.log(`   Validation: ${cp.validation_passed ? '✅ PASSED' : '❌ FAILED'}`)
  cp.notes.forEach(note => console.log(`   ${note}`))
  console.log('')
}

async function rebuildPipeline() {
  const client = getClickHouseClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('REBUILD P&L PIPELINE FROM SOURCE OF TRUTH')
    console.log('='.repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log(`Phantom condition test: ${PHANTOM_CONDITION}`)
    console.log(`Target wallet test: ${TARGET_WALLET}`)
    console.log('='.repeat(80) + '\n')

    // ========================================================================
    // STAGE 1: Rebuild trade_cashflows_v3
    // ========================================================================
    console.log('STAGE 1: Rebuilding trade_cashflows_v3 from vw_clob_fills_enriched\n')
    const stage1Start = Date.now()

    console.log('Step 1a: Check source table...\n')

    const sourceCheckResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_fills,
          uniq(user_eoa) as unique_wallets,
          uniq(\`cf.condition_id\`) as unique_markets
        FROM vw_clob_fills_enriched
      `,
      format: 'JSONEachRow'
    })
    const sourceCheck = await sourceCheckResult.json<any[]>()

    console.log('Source table (vw_clob_fills_enriched):')
    console.log(`  Total fills: ${parseInt(sourceCheck[0].total_fills).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(sourceCheck[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique markets: ${parseInt(sourceCheck[0].unique_markets).toLocaleString()}\n`)

    console.log('Step 1b: Creating trade_cashflows_v3_fixed...\n')
    console.log('This will take 5-15 minutes...\n')

    // Create empty table structure first
    await client.command({
      query: `
        CREATE TABLE trade_cashflows_v3_fixed (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          cashflow_usdc Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm, outcome_idx)
      `
    })

    console.log('✅ Table structure created, now inserting data...\n')

    // Insert data separately to avoid header overflow
    await client.command({
      query: `
        INSERT INTO trade_cashflows_v3_fixed
        SELECT
          lower(user_eoa) AS wallet,
          lower(replaceAll(\`cf.condition_id\`, '0x', '')) AS condition_id_norm,
          0 AS outcome_idx,
          round(
            price * size * if(side = 'BUY', -1, 1),
            8
          ) AS cashflow_usdc
        FROM vw_clob_fills_enriched
        WHERE length(replaceAll(\`cf.condition_id\`, '0x', '')) = 64
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        send_progress_in_http_headers: 0
      }
    })

    const stage1Duration = Math.round((Date.now() - stage1Start) / 1000)

    console.log(`✅ trade_cashflows_v3_fixed created in ${stage1Duration}s\n`)

    // Validation 1: Row count
    console.log('Step 1c: Validating row count...\n')

    const newCountResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets,
          uniq(condition_id_norm) as unique_markets
        FROM trade_cashflows_v3_fixed
      `,
      format: 'JSONEachRow'
    })
    const newCount = await newCountResult.json<any[]>()

    console.log('New table (trade_cashflows_v3_fixed):')
    console.log(`  Total rows: ${parseInt(newCount[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(newCount[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique markets: ${parseInt(newCount[0].unique_markets).toLocaleString()}\n`)

    const newRows = parseInt(newCount[0].total_rows)

    // Validation 2: Phantom condition test
    console.log('Step 1d: CRITICAL - Testing phantom condition...\n')

    const phantomTestResult = await client.query({
      query: `
        SELECT DISTINCT wallet
        FROM trade_cashflows_v3_fixed
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const phantomWallets = await phantomTestResult.json<any[]>()

    console.log(`Phantom condition ${PHANTOM_CONDITION}:`)
    console.log(`  Wallets in NEW table: ${phantomWallets.length}`)
    console.log(`  Expected: 5 (from vw_clob_fills_enriched)`)

    if (phantomWallets.length === 5) {
      console.log(`  ✅ VALIDATION PASSED - Phantom condition fixed!\n`)
    } else {
      console.log(`  ❌ VALIDATION FAILED - Expected 5 wallets, got ${phantomWallets.length}\n`)
      throw new Error('Phantom condition validation failed')
    }

    // Check if target wallet is gone
    const targetInNew = phantomWallets.find(w => w.wallet.toLowerCase() === TARGET_WALLET.toLowerCase())
    if (targetInNew) {
      console.log(`  ❌ WARNING - Target wallet still in new table (should be removed)\n`)
    } else {
      console.log(`  ✅ Target wallet correctly removed from phantom condition\n`)
    }

    // Validation 3: Compare old vs new
    console.log('Step 1e: Comparing old vs new table...\n')

    const oldCountResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets,
          uniq(condition_id_norm) as unique_markets
        FROM trade_cashflows_v3
      `,
      format: 'JSONEachRow'
    })
    const oldCount = await oldCountResult.json<any[]>()

    console.log('Old table (trade_cashflows_v3):')
    console.log(`  Total rows: ${parseInt(oldCount[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(oldCount[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique markets: ${parseInt(oldCount[0].unique_markets).toLocaleString()}\n`)

    const oldRows = parseInt(oldCount[0].total_rows)
    const rowDiff = newRows - oldRows
    const rowDiffPct = (rowDiff / oldRows * 100).toFixed(1)

    console.log('Comparison:')
    console.log(`  Row difference: ${rowDiff.toLocaleString()} (${rowDiffPct}%)`)
    console.log(`  Expected: New table should be similar size (within ±20%)\n`)

    if (Math.abs(parseFloat(rowDiffPct)) > 50) {
      console.log(`  ⚠️  WARNING - Row count differs by more than 50%`)
      console.log(`  This may indicate data loss. Review carefully.\n`)
    }

    logCheckpoint({
      stage: 'trade_cashflows_v3 rebuild',
      timestamp: new Date().toISOString(),
      duration_seconds: stage1Duration,
      rows_created: newRows,
      validation_passed: phantomWallets.length === 5 && !targetInNew,
      notes: [
        `Old rows: ${oldRows.toLocaleString()}`,
        `New rows: ${newRows.toLocaleString()}`,
        `Difference: ${rowDiff.toLocaleString()} (${rowDiffPct}%)`,
        `Phantom condition: ${phantomWallets.length} wallets (expected 5)`,
        `Target wallet removed: ${!targetInNew ? 'YES' : 'NO'}`
      ]
    })

    // ========================================================================
    // STAGE 2: Atomic Swap
    // ========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 2: Atomic Swap')
    console.log('='.repeat(80) + '\n')

    const stage2Start = Date.now()

    console.log('Step 2a: Renaming old table to _corrupted...\n')

    await client.command({
      query: 'RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_corrupted'
    })

    console.log('✅ Old table renamed: trade_cashflows_v3 → trade_cashflows_v3_corrupted\n')

    console.log('Step 2b: Promoting new table to canonical...\n')

    await client.command({
      query: 'RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3'
    })

    console.log('✅ New table promoted: trade_cashflows_v3_fixed → trade_cashflows_v3\n')

    const stage2Duration = Math.round((Date.now() - stage2Start) / 1000)

    // Verify swap
    const verifyResult = await client.query({
      query: 'SELECT COUNT(*) as count FROM trade_cashflows_v3',
      format: 'JSONEachRow'
    })
    const verify = await verifyResult.json<any[]>()
    const currentRows = parseInt(verify[0].count)

    if (currentRows === newRows) {
      console.log(`✅ Swap verified: trade_cashflows_v3 now has ${currentRows.toLocaleString()} rows\n`)
    } else {
      console.log(`❌ Swap verification failed: Expected ${newRows}, got ${currentRows}\n`)
      throw new Error('Atomic swap verification failed')
    }

    logCheckpoint({
      stage: 'Atomic swap',
      timestamp: new Date().toISOString(),
      duration_seconds: stage2Duration,
      validation_passed: currentRows === newRows,
      notes: [
        'Old table → trade_cashflows_v3_corrupted',
        'New table → trade_cashflows_v3 (canonical)',
        `Verified row count: ${currentRows.toLocaleString()}`
      ]
    })

    // ========================================================================
    // STAGE 3: Rebuild outcome_positions_v2
    // ========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 3: Rebuilding outcome_positions_v2')
    console.log('='.repeat(80) + '\n')

    const stage3Start = Date.now()

    console.log('Step 3a: Dropping old outcome_positions_v2...\n')

    await client.command({
      query: 'DROP TABLE IF EXISTS outcome_positions_v2_old'
    })

    try {
      await client.command({
        query: 'RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old'
      })
      console.log('✅ Old table backed up: outcome_positions_v2 → outcome_positions_v2_old\n')
    } catch (e) {
      console.log('ℹ️  No existing outcome_positions_v2 to backup\n')
    }

    console.log('Step 3b: Creating new outcome_positions_v2...\n')
    console.log('This will take 5-10 minutes...\n')

    // Create empty table structure first
    await client.command({
      query: `
        CREATE TABLE outcome_positions_v2 (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          net_shares Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm, outcome_idx)
      `
    })

    console.log('✅ Table structure created, now inserting data...\n')

    // Insert data separately
    await client.command({
      query: `
        INSERT INTO outcome_positions_v2
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          sum(cashflow_usdc) AS net_shares
        FROM trade_cashflows_v3
        GROUP BY wallet, condition_id_norm, outcome_idx
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        send_progress_in_http_headers: 0
      }
    })

    const stage3Duration = Math.round((Date.now() - stage3Start) / 1000)

    console.log(`✅ outcome_positions_v2 created in ${stage3Duration}s\n`)

    // Validation: Row count
    const positionsCountResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets
        FROM outcome_positions_v2
      `,
      format: 'JSONEachRow'
    })
    const positionsCount = await positionsCountResult.json<any[]>()
    const positionsRows = parseInt(positionsCount[0].total_rows)

    console.log(`  Total positions: ${positionsRows.toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(positionsCount[0].unique_wallets).toLocaleString()}\n`)

    // Test phantom condition
    const phantomPositionsResult = await client.query({
      query: `
        SELECT DISTINCT wallet
        FROM outcome_positions_v2
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const phantomPositions = await phantomPositionsResult.json<any[]>()

    console.log(`Phantom condition test:`)
    console.log(`  Wallets in outcome_positions_v2: ${phantomPositions.length}`)
    console.log(`  Expected: 5\n`)

    const targetInPositions = phantomPositions.find(w => w.wallet.toLowerCase() === TARGET_WALLET.toLowerCase())

    logCheckpoint({
      stage: 'outcome_positions_v2 rebuild',
      timestamp: new Date().toISOString(),
      duration_seconds: stage3Duration,
      rows_created: positionsRows,
      validation_passed: phantomPositions.length === 5 && !targetInPositions,
      notes: [
        `Total positions: ${positionsRows.toLocaleString()}`,
        `Phantom condition: ${phantomPositions.length} wallets (expected 5)`,
        `Target wallet removed: ${!targetInPositions ? 'YES' : 'NO'}`
      ]
    })

    // ========================================================================
    // STAGE 4: Rebuild realized_pnl_by_market_final
    // ========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 4: Rebuilding realized_pnl_by_market_final')
    console.log('='.repeat(80) + '\n')

    const stage4Start = Date.now()

    console.log('Step 4a: Backing up old table...\n')

    await client.command({
      query: 'DROP TABLE IF EXISTS realized_pnl_by_market_final_old'
    })

    try {
      await client.command({
        query: 'RENAME TABLE realized_pnl_by_market_final TO realized_pnl_by_market_final_old'
      })
      console.log('✅ Old table backed up: realized_pnl_by_market_final → _old\n')
    } catch (e) {
      console.log('ℹ️  No existing realized_pnl_by_market_final to backup\n')
    }

    console.log('Step 4b: Creating new realized_pnl_by_market_final...\n')
    console.log('This will take 10-20 minutes...\n')

    // Create empty table structure first
    await client.command({
      query: `
        CREATE TABLE realized_pnl_by_market_final (
          wallet String,
          condition_id_norm String,
          realized_pnl_usd Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm)
      `
    })

    console.log('✅ Table structure created, now inserting data...\n')

    // Insert data separately
    await client.command({
      query: `
        INSERT INTO realized_pnl_by_market_final
        WITH winning_outcomes AS (
          SELECT
            condition_id_norm,
            toInt16(win_idx) AS win_idx
          FROM winning_index
        )
        SELECT
          p.wallet,
          p.condition_id_norm,
          round(
            sum(toFloat64(c.cashflow_usdc)) + sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
            2
          ) AS realized_pnl_usd
        FROM outcome_positions_v2 AS p
        ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
        ANY LEFT JOIN trade_cashflows_v3 AS c ON
          (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
        WHERE w.win_idx IS NOT NULL
        GROUP BY p.wallet, p.condition_id_norm
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
        send_progress_in_http_headers: 0
      }
    })

    const stage4Duration = Math.round((Date.now() - stage4Start) / 1000)

    console.log(`✅ realized_pnl_by_market_final created in ${stage4Duration}s\n`)

    // Validation: Row count
    const pnlCountResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets,
          SUM(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_final
      `,
      format: 'JSONEachRow'
    })
    const pnlCount = await pnlCountResult.json<any[]>()
    const pnlRows = parseInt(pnlCount[0].total_rows)
    const totalPnl = parseFloat(pnlCount[0].total_pnl)

    console.log(`  Total P&L entries: ${pnlRows.toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(pnlCount[0].unique_wallets).toLocaleString()}`)
    console.log(`  Total P&L: $${(totalPnl / 1000000).toFixed(2)}M\n`)

    // Test phantom condition
    const phantomPnlResult = await client.query({
      query: `
        SELECT DISTINCT wallet
        FROM realized_pnl_by_market_final
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const phantomPnl = await phantomPnlResult.json<any[]>()

    console.log(`Phantom condition test:`)
    console.log(`  Wallets in realized_pnl_by_market_final: ${phantomPnl.length}`)
    console.log(`  Expected: 5\n`)

    const targetInPnl = phantomPnl.find(w => w.wallet.toLowerCase() === TARGET_WALLET.toLowerCase())

    // Test target wallet
    const targetPnlResult = await client.query({
      query: `
        SELECT
          COUNT(*) as market_count,
          SUM(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_final
        WHERE lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const targetPnl = await targetPnlResult.json<any[]>()
    const targetMarkets = parseInt(targetPnl[0].market_count)
    const targetTotal = parseFloat(targetPnl[0].total_pnl)

    console.log(`Target wallet test:`)
    console.log(`  Markets in NEW P&L: ${targetMarkets}`)
    console.log(`  Expected: ~36 (wallet's actual trades)`)
    console.log(`  Old (corrupted): 134 markets`)
    console.log(`  Total P&L: $${(targetTotal / 1000).toFixed(1)}K`)
    console.log(`  Expected: ~+$179K (Dome baseline)\n`)

    logCheckpoint({
      stage: 'realized_pnl_by_market_final rebuild',
      timestamp: new Date().toISOString(),
      duration_seconds: stage4Duration,
      rows_created: pnlRows,
      validation_passed: phantomPnl.length === 5 && !targetInPnl && targetMarkets < 50,
      notes: [
        `Total P&L entries: ${pnlRows.toLocaleString()}`,
        `Phantom condition: ${phantomPnl.length} wallets (expected 5)`,
        `Target wallet removed from phantom: ${!targetInPnl ? 'YES' : 'NO'}`,
        `Target wallet markets: ${targetMarkets} (expected ~36, was 134)`,
        `Target wallet P&L: $${(targetTotal / 1000).toFixed(1)}K (expected ~$179K)`
      ]
    })

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('=' .repeat(80))
    console.log('REBUILD COMPLETE')
    console.log('='.repeat(80) + '\n')

    const totalDuration = Math.round((Date.now() - stage1Start) / 1000)
    const minutes = Math.floor(totalDuration / 60)
    const seconds = totalDuration % 60

    console.log(`Total duration: ${minutes}m ${seconds}s\n`)

    console.log('Checkpoints:\n')
    checkpoints.forEach((cp, idx) => {
      console.log(`${idx + 1}. ${cp.stage}`)
      console.log(`   Status: ${cp.validation_passed ? '✅ PASSED' : '❌ FAILED'}`)
      console.log(`   Duration: ${cp.duration_seconds}s`)
      if (cp.rows_created) console.log(`   Rows: ${cp.rows_created.toLocaleString()}`)
      console.log('')
    })

    const allPassed = checkpoints.every(cp => cp.validation_passed)

    if (allPassed) {
      console.log('✅ ALL VALIDATIONS PASSED\n')
      console.log('Next step: Re-run Dome validation to verify fix\n')
      console.log('Command: npx tsx tmp/validate-snapshot-vs-dome.ts\n')
    } else {
      console.log('⚠️  SOME VALIDATIONS FAILED\n')
      console.log('Review checkpoints above before proceeding\n')
    }

    // Save checkpoint log
    const logOutput = {
      completed_at: new Date().toISOString(),
      total_duration_seconds: totalDuration,
      checkpoints,
      all_validations_passed: allPassed,
      phantom_condition: PHANTOM_CONDITION,
      target_wallet: TARGET_WALLET,
      phantom_fix_verified: phantomPnl.length === 5 && !targetInPnl,
      target_wallet_markets_reduced: targetMarkets < 50
    }

    fs.writeFileSync(
      'tmp/pipeline-rebuild-log.json',
      JSON.stringify(logOutput, null, 2)
    )

    console.log('📝 Checkpoint log saved to: tmp/pipeline-rebuild-log.json\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }

    console.log('\n⚠️  REBUILD FAILED - Rolling back may be required\n')
    console.log('Corrupted table backup: trade_cashflows_v3_corrupted\n')

    throw error
  } finally {
    await client.close()
  }
}

rebuildPipeline()
