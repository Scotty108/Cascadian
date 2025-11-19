#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

async function rebuildStage4() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('STAGE 4: Rebuild realized_pnl_by_market_final')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    const stage4Start = Date.now()

    // Drop old table
    console.log('Step 4a: Dropping old realized_pnl_by_market_final...\n')

    await client.exec({
      query: 'DROP TABLE IF EXISTS realized_pnl_by_market_final'
    })

    console.log('✅ Old table dropped\n')

    // Create new table with clean data
    console.log('Step 4b: Creating realized_pnl_by_market_final from clean data...\n')
    console.log('⏳ This will JOIN clean positions + cashflows with resolutions...\n')

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

    console.log(`✅ realized_pnl_by_market_final rebuilt in ${stage4Duration}s\n`)

    // Validation: Row count
    console.log('Step 4c: Validating realized_pnl_by_market_final...\n')

    const pnlResult = await client.query({
      query: 'SELECT count() as total FROM realized_pnl_by_market_final',
      format: 'JSONEachRow'
    })
    const pnlData = await pnlResult.json<any[]>()
    const pnlRows = parseInt(pnlData[0].total)

    console.log(`  Total P&L entries: ${pnlRows.toLocaleString()}\n`)

    // Validation: Phantom condition check
    console.log('Step 4d: Testing phantom condition elimination...\n')
    console.log(`  Phantom: ${PHANTOM_CONDITION}`)
    console.log(`  Target wallet: ${TARGET_WALLET}\n`)

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

    console.log(`  Phantom in target wallet P&L: ${phantomCount} (expected: 0)`)
    if (phantomCount === 0) {
      console.log('  ✅ PHANTOM ELIMINATED from final P&L\n')
    } else {
      console.log('  ❌ WARNING: Phantom still present in final output!\n')
    }

    // Validation: Target wallet market count
    console.log('Step 4e: Checking target wallet market count...\n')

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

    console.log(`  Target wallet markets in NEW P&L: ${targetMarkets} (expected: ~36)\n`)

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

    console.log(`  Target wallet markets in BACKUP: ${backupMarkets} (had phantoms)\n`)

    const reduction = backupMarkets - targetMarkets
    const reductionPct = ((reduction / backupMarkets) * 100).toFixed(1)

    if (reduction > 0) {
      console.log(`  📊 Phantom markets eliminated: ${reduction} (${reductionPct}% reduction)\n`)
    } else if (reduction < 0) {
      console.log(`  ⚠️  Warning: Market count increased by ${Math.abs(reduction)}\n`)
    } else {
      console.log(`  📊 Market count unchanged (${targetMarkets} markets)\n`)
    }

    console.log('=' .repeat(80))
    console.log('✅ STAGE 4 COMPLETE')
    console.log('=' .repeat(80))
    console.log(`Duration: ${stage4Duration}s\n`)
    console.log('Pipeline Status:')
    console.log('  ✅ Stage 1: trade_cashflows_v3 rebuilt from source')
    console.log('  ✅ Stage 2: Tables swapped atomically')
    console.log('  ✅ Stage 3: outcome_positions_v2 rebuilt')
    console.log('  ✅ Stage 4: realized_pnl_by_market_final rebuilt\n')
    console.log('Next step: Run Dome validation to compare to baseline\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

rebuildStage4()
