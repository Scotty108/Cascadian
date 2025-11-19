#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

async function rebuildPipeline() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('REBUILD P&L PIPELINE FROM SOURCE OF TRUTH (STREAMING VERSION)')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log(`Phantom condition test: ${PHANTOM_CONDITION}`)
    console.log(`Target wallet test: ${TARGET_WALLET}`)
    console.log('=' .repeat(80))
    console.log('')

    // =========================================================================
    // STAGE 1: Rebuild trade_cashflows_v3 from vw_clob_fills_enriched
    // =========================================================================
    console.log('STAGE 1: Rebuilding trade_cashflows_v3 from vw_clob_fills_enriched\n')

    const stage1Start = Date.now()

    // Step 1a: Check source
    console.log('Step 1a: Check source table...\n')

    const sourceCheck = await client.query({
      query: `
        SELECT
          count() as total_fills,
          uniq(user_eoa) as unique_wallets,
          uniq(\`cf.condition_id\`) as unique_markets
        FROM vw_clob_fills_enriched
      `,
      format: 'JSONEachRow'
    })
    const sourceData = await sourceCheck.json<any[]>()

    console.log('Source table (vw_clob_fills_enriched):')
    console.log(`  Total fills: ${parseInt(sourceData[0].total_fills).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(sourceData[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique markets: ${parseInt(sourceData[0].unique_markets).toLocaleString()}\n`)

    // Step 1b: Create table structure
    console.log('Step 1b: Creating trade_cashflows_v3_fixed structure...\n')

    await client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS trade_cashflows_v3_fixed (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          cashflow_usdc Float64
        ) ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm, outcome_idx)
      `
    })

    console.log('✅ Table structure created\n')

    // Step 1c: Insert data using exec (streaming mode)
    console.log('Step 1c: Inserting data from vw_clob_fills_enriched...\n')
    console.log('⏳ This will take 5-15 minutes (37M+ rows)...\n')
    console.log('Progress will not be shown to avoid header overflow.\n')

    const insertStart = Date.now()

    // Use exec() instead of command() - it's designed for large operations
    await client.exec({
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
      `
    })

    const insertDuration = Math.round((Date.now() - insertStart) / 1000)
    const stage1Duration = Math.round((Date.now() - stage1Start) / 1000)

    console.log(`✅ Data inserted in ${insertDuration}s\n`)
    console.log(`✅ trade_cashflows_v3_fixed created in ${stage1Duration}s\n`)

    // Step 1d: Validation - Row count
    console.log('Step 1d: Validating row count...\n')

    const newCountResult = await client.query({
      query: 'SELECT count() as total FROM trade_cashflows_v3_fixed',
      format: 'JSONEachRow'
    })
    const newCount = await newCountResult.json<any[]>()

    console.log(`  New table rows: ${parseInt(newCount[0].total).toLocaleString()}\n`)

    // Step 1e: Validation - Phantom condition
    console.log('Step 1e: Testing phantom condition...\n')
    console.log(`  Phantom: ${PHANTOM_CONDITION}\n`)

    const phantomResult = await client.query({
      query: `
        SELECT DISTINCT wallet
        FROM trade_cashflows_v3_fixed
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const phantomWallets = await phantomResult.json<any[]>()

    console.log(`  Wallets in fixed table: ${phantomWallets.length} (expected: 5)\n`)

    if (phantomWallets.length === 5) {
      console.log('  ✅ VALIDATION PASSED - Phantom condition fixed!\n')
    } else {
      console.log(`  ❌ VALIDATION FAILED - Expected 5 wallets, got ${phantomWallets.length}\n`)
      console.log('  Phantom wallets found:')
      phantomWallets.forEach(w => console.log(`    - ${w.wallet}`))
      console.log('')
      throw new Error('Phantom condition validation failed')
    }

    // Step 1f: Validation - Target wallet
    console.log('Step 1f: Testing target wallet...\n')

    const targetResult = await client.query({
      query: `
        SELECT count(DISTINCT condition_id_norm) as condition_count
        FROM trade_cashflows_v3_fixed
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const targetData = await targetResult.json<any[]>()
    const targetConditions = parseInt(targetData[0].condition_count)

    console.log(`  Target wallet conditions: ${targetConditions} (expected: ~36, not 134)\n`)

    if (targetConditions < 50) {
      console.log('  ✅ Target wallet looks clean (no longer 134 phantom markets)\n')
    } else {
      console.log(`  ⚠️  Warning: Target wallet still has many conditions (${targetConditions})\n`)
    }

    // =========================================================================
    // STAGE 2: Atomic Table Swap
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 2: Atomic Table Swap')
    console.log('=' .repeat(80))
    console.log('')
    console.log('This will rename:')
    console.log('  trade_cashflows_v3 → trade_cashflows_v3_corrupted')
    console.log('  trade_cashflows_v3_fixed → trade_cashflows_v3\n')
    console.log('⚠️  This modifies production tables!\n')
    console.log('▶️  Proceeding in 5 seconds... (Ctrl+C to cancel)\n')

    await new Promise(resolve => setTimeout(resolve, 5000))

    const stage2Start = Date.now()

    await client.exec({
      query: `
        RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_corrupted,
                     trade_cashflows_v3_fixed TO trade_cashflows_v3
      `
    })

    const stage2Duration = Math.round((Date.now() - stage2Start) / 1000)

    console.log(`✅ Tables swapped in ${stage2Duration}s\n`)

    // Verify swap
    const canonicalResult = await client.query({
      query: 'SELECT count() as total FROM trade_cashflows_v3',
      format: 'JSONEachRow'
    })
    const canonicalData = await canonicalResult.json<any[]>()

    console.log(`Canonical table (trade_cashflows_v3) now has: ${parseInt(canonicalData[0].total).toLocaleString()} rows\n`)

    // =========================================================================
    // STAGE 3: Rebuild outcome_positions_v2
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 3: Rebuilding outcome_positions_v2')
    console.log('=' .repeat(80))
    console.log('')

    const stage3Start = Date.now()

    // Drop old table
    await client.exec({
      query: 'DROP TABLE IF EXISTS outcome_positions_v2'
    })

    console.log('Dropped old outcome_positions_v2\n')

    // Create new table (using exec for large operation)
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

    const positionsResult = await client.query({
      query: 'SELECT count() as total FROM outcome_positions_v2',
      format: 'JSONEachRow'
    })
    const positionsData = await positionsResult.json<any[]>()

    console.log(`✅ outcome_positions_v2 rebuilt in ${stage3Duration}s`)
    console.log(`  Total positions: ${parseInt(positionsData[0].total).toLocaleString()}\n`)

    // =========================================================================
    // STAGE 4: Rebuild realized_pnl_by_market_final
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('STAGE 4: Rebuilding realized_pnl_by_market_final')
    console.log('=' .repeat(80))
    console.log('')

    const stage4Start = Date.now()

    // Drop old table
    await client.exec({
      query: 'DROP TABLE IF EXISTS realized_pnl_by_market_final'
    })

    console.log('Dropped old realized_pnl_by_market_final\n')

    // Create new table with clean data
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

    const pnlResult = await client.query({
      query: 'SELECT count() as total FROM realized_pnl_by_market_final',
      format: 'JSONEachRow'
    })
    const pnlData = await pnlResult.json<any[]>()

    console.log(`✅ realized_pnl_by_market_final rebuilt in ${stage4Duration}s`)
    console.log(`  Total P&L entries: ${parseInt(pnlData[0].total).toLocaleString()}\n`)

    // =========================================================================
    // FINAL VALIDATION
    // =========================================================================
    console.log('=' .repeat(80))
    console.log('FINAL VALIDATION')
    console.log('=' .repeat(80))
    console.log('')

    // Check phantom condition in final output
    const finalPhantomResult = await client.query({
      query: `
        SELECT count() as count
        FROM realized_pnl_by_market_final
        WHERE condition_id_norm = '${PHANTOM_CONDITION}'
          AND wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const finalPhantomData = await finalPhantomResult.json<any[]>()
    const phantomCount = parseInt(finalPhantomData[0].count)

    console.log(`Phantom condition in target wallet P&L: ${phantomCount} (expected: 0)`)
    if (phantomCount === 0) {
      console.log('✅ PHANTOM ELIMINATED from final P&L\n')
    } else {
      console.log('❌ WARNING: Phantom still present in final output!\n')
    }

    // Check target wallet total markets
    const targetMarketsResult = await client.query({
      query: `
        SELECT count() as count
        FROM realized_pnl_by_market_final
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const targetMarketsData = await targetMarketsResult.json<any[]>()
    const targetMarkets = parseInt(targetMarketsData[0].count)

    console.log(`Target wallet total markets in P&L: ${targetMarkets} (was 134, should be ~36)\n`)

    const totalDuration = Math.round((Date.now() - stage1Start) / 1000)

    console.log('=' .repeat(80))
    console.log('✅ REBUILD COMPLETE')
    console.log('=' .repeat(80))
    console.log(`Total time: ${totalDuration}s (~${Math.round(totalDuration / 60)} minutes)`)
    console.log(`Finished: ${new Date().toISOString()}\n`)
    console.log('Next steps:')
    console.log('1. Re-run Dome validation (compare to realized_pnl_by_market_backup_20251111)')
    console.log('2. Check if sign errors and magnitude inflation are fixed')
    console.log('3. Document results in tmp/SIGN_FIX_VALIDATION_RESULTS.md\n')
    console.log('Corrupted table preserved as: trade_cashflows_v3_corrupted\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    console.error('\n⚠️  REBUILD FAILED - Rolling back may be required\n')
    console.error('Corrupted table backup: trade_cashflows_v3_corrupted\n')
    throw error
  } finally {
    await client.close()
  }
}

rebuildPipeline()
