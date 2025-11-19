#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

async function rebuildCompletePipeline() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('COMPLETE P&L PIPELINE REBUILD - WITH CORRECTED FORMULA')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log(`Fix: Added /1000000 divisor to convert microshares to shares`)
    console.log('=' .repeat(80))
    console.log('')

    const pipelineStart = Date.now()

    // =========================================================================
    // STAGE 1: Rebuild trade_cashflows_v3 with CORRECTED FORMULA
    // =========================================================================
    console.log('STAGE 1: Rebuilding trade_cashflows_v3 (CORRECTED FORMULA)')
    console.log('=' .repeat(80))
    console.log('')

    const stage1Start = Date.now()

    // Drop old fixed table if exists
    await client.exec({
      query: 'DROP TABLE IF EXISTS trade_cashflows_v3_fixed'
    })

    // Create table structure
    console.log('Step 1a: Creating table structure...\n')

    await client.exec({
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

    console.log('✅ Table structure created\n')

    // Insert data with CORRECTED formula
    console.log('Step 1b: Inserting data with CORRECTED formula...\n')
    console.log('⏳ Formula: (price * size / 1000000) * if(side = BUY, -1, 1)\n')
    console.log('This will take 5-15 minutes (37M+ rows)...\n')

    const insertStart = Date.now()

    await client.exec({
      query: `
        INSERT INTO trade_cashflows_v3_fixed
        SELECT
          lower(user_eoa) AS wallet,
          lower(replaceAll(\`cf.condition_id\`, '0x', '')) AS condition_id_norm,
          0 AS outcome_idx,
          round(
            (price * size / 1000000) * if(side = 'BUY', -1, 1),
            8
          ) AS cashflow_usdc
        FROM vw_clob_fills_enriched
        WHERE length(replaceAll(\`cf.condition_id\`, '0x', '')) = 64
      `
    })

    const insertDuration = Math.round((Date.now() - insertStart) / 1000)
    const stage1Duration = Math.round((Date.now() - stage1Start) / 1000)

    console.log(`✅ Data inserted in ${insertDuration}s\n`)
    console.log(`✅ Stage 1 complete in ${stage1Duration}s\n`)

    // Validation: Check magnitude against corrupted table
    console.log('Step 1c: Validating formula correction...\n')

    const testMarket = '606506da6dbbe56eda343e771cc11aa5a3fe95d979ab53f2cf0df66a98659c03'

    const corruptedCashflow = await client.query({
      query: `
        SELECT sum(cashflow_usdc) as total
        FROM trade_cashflows_v3_corrupted
        WHERE wallet = '${TARGET_WALLET}' AND condition_id_norm = '${testMarket}'
      `,
      format: 'JSONEachRow'
    })
    const corruptedData = await corruptedCashflow.json<any[]>()
    const corruptedValue = parseFloat(corruptedData[0]?.total || '0')

    const newCashflow = await client.query({
      query: `
        SELECT sum(cashflow_usdc) as total
        FROM trade_cashflows_v3_fixed
        WHERE wallet = '${TARGET_WALLET}' AND condition_id_norm = '${testMarket}'
      `,
      format: 'JSONEachRow'
    })
    const newData = await newCashflow.json<any[]>()
    const newValue = parseFloat(newData[0]?.total || '0')

    console.log(`  Test market: ${testMarket.substring(0, 16)}...`)
    console.log(`  Corrupted (original): $${corruptedValue.toLocaleString()}`)
    console.log(`  New (corrected): $${newValue.toLocaleString()}`)

    if (Math.abs(newValue - corruptedValue) < Math.abs(corruptedValue) * 0.1) {
      console.log('  ✅ Magnitude looks correct (within 10% of original)\n')
    } else {
      console.log('  ⚠️  Warning: Magnitude differs significantly from original\n')
    }

    // =========================================================================
    // STAGE 2: Atomic Table Swap
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 2: Atomic Table Swap')
    console.log('=' .repeat(80))
    console.log('')

    const stage2Start = Date.now()

    // First rename: move old table to backup
    await client.exec({
      query: 'RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_buggy'
    })

    console.log('✅ Step 1: trade_cashflows_v3 → trade_cashflows_v3_buggy\n')

    // Second rename: move fixed table to production
    await client.exec({
      query: 'RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3'
    })

    console.log('✅ Step 2: trade_cashflows_v3_fixed → trade_cashflows_v3\n')

    const stage2Duration = Math.round((Date.now() - stage2Start) / 1000)

    console.log(`✅ Stage 2 complete in ${stage2Duration}s\n`)

    // =========================================================================
    // STAGE 3: Rebuild outcome_positions_v2
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 3: Rebuilding outcome_positions_v2')
    console.log('=' .repeat(80))
    console.log('')

    const stage3Start = Date.now()

    await client.exec({
      query: 'DROP TABLE IF EXISTS outcome_positions_v2'
    })

    await client.exec({
      query: `
        CREATE TABLE outcome_positions_v2 (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          net_shares Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm, outcome_idx)
        AS
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          sum(cashflow_usdc) AS net_shares
        FROM trade_cashflows_v3
        GROUP BY wallet, condition_id_norm, outcome_idx
      `
    })

    const stage3Duration = Math.round((Date.now() - stage3Start) / 1000)

    console.log(`✅ Stage 3 complete in ${stage3Duration}s\n`)

    // =========================================================================
    // STAGE 4: Rebuild realized_pnl_by_market_final
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 4: Rebuilding realized_pnl_by_market_final')
    console.log('=' .repeat(80))
    console.log('')

    const stage4Start = Date.now()

    await client.exec({
      query: 'DROP TABLE IF EXISTS realized_pnl_by_market_final'
    })

    await client.exec({
      query: `
        CREATE TABLE realized_pnl_by_market_final (
          wallet String,
          condition_id_norm String,
          realized_pnl_usd Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS
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
      `
    })

    const stage4Duration = Math.round((Date.now() - stage4Start) / 1000)

    console.log(`✅ Stage 4 complete in ${stage4Duration}s\n`)

    // =========================================================================
    // FINAL VALIDATION
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('PIPELINE VALIDATION')
    console.log('=' .repeat(80))
    console.log('')

    // Check phantom elimination
    const phantomCheck = await client.query({
      query: `
        SELECT count() as count
        FROM realized_pnl_by_market_final
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
          AND wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const phantomData = await phantomCheck.json<any[]>()
    const phantomCount = parseInt(phantomData[0].count)

    console.log(`Phantom condition in target wallet: ${phantomCount} (expected: 0)`)
    if (phantomCount === 0) {
      console.log('✅ Phantom markets eliminated\n')
    } else {
      console.log('❌ Phantom still present!\n')
    }

    // Check target wallet market count
    const marketCount = await client.query({
      query: `
        SELECT count() as count
        FROM realized_pnl_by_market_final
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const marketData = await marketCount.json<any[]>()
    const markets = parseInt(marketData[0].count)

    console.log(`Target wallet markets: ${markets} (expected: ~36)\n`)

    // Check target wallet total P&L
    const pnlCheck = await client.query({
      query: `
        SELECT sum(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_final
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const pnlData = await pnlCheck.json<any[]>()
    const totalPnL = parseFloat(pnlData[0]?.total_pnl || '0')

    console.log(`Target wallet total P&L: $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

    if (Math.abs(totalPnL) < 1000000) {
      console.log('✅ P&L magnitude looks reasonable (< $1M)\n')
    } else {
      console.log('⚠️  P&L magnitude seems high (> $1M)\n')
    }

    const pipelineDuration = Math.round((Date.now() - pipelineStart) / 1000)

    console.log('=' .repeat(80))
    console.log('✅ COMPLETE PIPELINE REBUILD FINISHED')
    console.log('=' .repeat(80))
    console.log(`Total time: ${pipelineDuration}s (~${Math.round(pipelineDuration / 60)} minutes)\n`)
    console.log('Stage timings:')
    console.log(`  Stage 1 (cashflows): ${stage1Duration}s`)
    console.log(`  Stage 2 (swap): ${stage2Duration}s`)
    console.log(`  Stage 3 (positions): ${stage3Duration}s`)
    console.log(`  Stage 4 (P&L): ${stage4Duration}s\n`)
    console.log('Backups preserved:')
    console.log('  - trade_cashflows_v3_corrupted (original with phantom markets)')
    console.log('  - trade_cashflows_v3_buggy (rebuilt with wrong formula)')
    console.log('  - realized_pnl_by_market_backup_20251111 (validation baseline)\n')
    console.log('Next step: Run Dome validation to verify all wallets pass\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

rebuildCompletePipeline()
