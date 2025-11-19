#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

async function continueRebuild() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('CONTINUE P&L PIPELINE REBUILD - STAGES 2-4')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    // =========================================================================
    // STAGE 2: Atomic Table Swap
    // =========================================================================
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

    // First rename: move old table to backup
    await client.exec({
      query: 'RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_corrupted'
    })

    console.log('✅ Step 1: trade_cashflows_v3 → trade_cashflows_v3_corrupted\n')

    // Second rename: move fixed table to production
    await client.exec({
      query: 'RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3'
    })

    console.log('✅ Step 2: trade_cashflows_v3_fixed → trade_cashflows_v3\n')

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

    // Compare to backup
    const backupMarketsResult = await client.query({
      query: `
        SELECT count() as count
        FROM realized_pnl_by_market_backup_20251111
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const backupMarketsData = await backupMarketsResult.json<any[]>()
    const backupMarkets = parseInt(backupMarketsData[0].count)

    console.log(`Target wallet in BACKUP: ${backupMarkets} markets\n`)

    const reduction = backupMarkets - targetMarkets
    const reductionPct = ((reduction / backupMarkets) * 100).toFixed(1)

    console.log(`📊 Phantom markets eliminated: ${reduction} (${reductionPct}% reduction)\n`)

    const totalDuration = stage2Duration + stage3Duration + stage4Duration

    console.log('=' .repeat(80))
    console.log('✅ REBUILD COMPLETE')
    console.log('=' .repeat(80))
    console.log(`Stages 2-4 time: ${totalDuration}s (~${Math.round(totalDuration / 60)} minutes)`)
    console.log(`Finished: ${new Date().toISOString()}\n`)
    console.log('Next steps:')
    console.log('1. Re-run Dome validation (compare to realized_pnl_by_market_backup_20251111)')
    console.log('2. Check if sign errors and magnitude inflation are also fixed')
    console.log('3. Document results in tmp/SIGN_FIX_VALIDATION_RESULTS.md\n')
    console.log('Corrupted table preserved as: trade_cashflows_v3_corrupted\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    console.error('\n⚠️  REBUILD FAILED\n')
    throw error
  } finally {
    await client.close()
  }
}

continueRebuild()
