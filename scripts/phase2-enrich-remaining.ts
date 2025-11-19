import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

/**
 * PHASE 2: Enrich remaining rows (125M - 159.6M)
 *
 * After Phase 1 stops at ~125M rows, this script:
 * 1. Finds rows in original trades_raw NOT in enriched table
 * 2. Inserts missing rows in 2M batches
 * 3. Verifies full enrichment coverage
 * 4. Performs final table swap when complete
 */

async function phase2() {
  try {
    console.log('PHASE 2: ENRICH REMAINING ROWS')
    console.log('═'.repeat(70))

    // Check current state
    const checkEnriched = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched_final'
    })
    const enrichedCount = parseInt(JSON.parse(await checkEnriched.text()).data[0].cnt)
    console.log(`Phase 1 result: ${enrichedCount.toLocaleString()} rows enriched`)
    console.log()

    const checkSource = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const sourceCount = parseInt(JSON.parse(await checkSource.text()).data[0].cnt)
    console.log(`Source table: ${sourceCount.toLocaleString()} rows`)

    const remaining = sourceCount - enrichedCount
    console.log(`Remaining to enrich: ${remaining.toLocaleString()} rows`)
    console.log()

    if (remaining <= 0) {
      console.log('✓ All rows already enriched! Skipping to verification.')
      console.log()
    } else {
      // Find which rows are missing
      console.log('Finding missing rows...')
      const missingCheck = await clickhouse.query({
        query: `
SELECT COUNT(*) as cnt FROM trades_raw
WHERE trade_id NOT IN (
  SELECT DISTINCT trade_id FROM trades_raw_enriched_final LIMIT ${enrichedCount}
)
        `
      })
      const missingCount = parseInt(JSON.parse(await missingCheck.text()).data[0].cnt)
      console.log(`Missing rows confirmed: ${missingCount.toLocaleString()}`)
      console.log()

      if (missingCount > 0) {
        console.log(`Phase 2: Inserting ${missingCount.toLocaleString()} missing rows in 2M batches...`)
        console.log()

        const batchSize = 2_000_000
        const numBatches = Math.ceil(missingCount / batchSize)
        let batchNum = 0

        for (let i = 0; i < numBatches; i++) {
          batchNum = i + 1
          process.stdout.write(`Batch ${batchNum}/${numBatches}...`)
          const start = Date.now()

          try {
            await clickhouse.query({
              query: `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.timestamp,
  t.side,
  t.entry_price,
  t.exit_price,
  t.shares,
  t.usd_value,
  t.pnl,
  t.is_closed,
  t.transaction_hash,
  t.created_at,
  t.close_price,
  t.fee_usd,
  t.slippage_usd,
  t.hours_held,
  t.bankroll_at_entry,
  t.outcome,
  t.fair_price_at_entry,
  t.pnl_gross,
  t.pnl_net,
  t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win,
  t.tx_timestamp,
  t.canonical_category,
  t.raw_tags,
  t.realized_pnl_usd,
  t.is_resolved,
  t.resolved_outcome
FROM (
  SELECT * FROM trades_raw
  WHERE trade_id NOT IN (
    SELECT DISTINCT trade_id FROM trades_raw_enriched_final
  )
  LIMIT ${batchSize}
) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
              `
            })
            const elapsed = ((Date.now() - start) / 1000).toFixed(0)
            console.log(` ✓ ${elapsed}s`)
          } catch (e: any) {
            console.log(` ✗`)
            console.error(`Error in batch ${batchNum}: ${e.message.substring(0, 100)}`)
            if (e.message.includes('Header overflow')) {
              console.log('Hit API limit - reduce batch size and retry')
              process.exit(1)
            }
          }
        }

        console.log()
      }
    }

    // Final verification
    console.log('═'.repeat(70))
    console.log('FINAL VERIFICATION')
    console.log('═'.repeat(70))

    const verify = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw_enriched_final
      `
    })

    const verifyData = JSON.parse(await verify.text()).data[0]
    const totalRows = parseInt(verifyData.total)
    const withId = parseInt(verifyData.with_id)
    const coverage = parseFloat(verifyData.coverage_pct)

    console.log(`Total rows: ${totalRows.toLocaleString()}`)
    console.log(`With condition_id: ${withId.toLocaleString()} (${coverage}%)`)
    console.log(`Without condition_id: ${totalRows - withId}`)
    console.log()

    // Success check
    if (coverage >= 95 && totalRows === sourceCount) {
      console.log('✅ ENRICHMENT SUCCESSFUL!')
      console.log(`Coverage: 51.47% → ${coverage}%`)
      console.log()

      // Swap tables
      console.log('Swapping tables (atomic)...')
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw TO trades_raw_pre_enrichment'
      })
      console.log('✓ Backed up original')

      await clickhouse.query({
        query: 'RENAME TABLE trades_raw_enriched_final TO trades_raw'
      })
      console.log('✓ Activated enriched table')

      console.log()
      console.log('═'.repeat(70))
      console.log('✓✓✓ ENRICHMENT COMPLETE AND ACTIVE! ✓✓✓')
      console.log('═'.repeat(70))
      console.log(`Ready for P&L calculations`)
    } else {
      console.log('⚠️  ENRICHMENT INCOMPLETE')
      console.log(`Total: ${totalRows.toLocaleString()}/${sourceCount.toLocaleString()}`)
      console.log(`Coverage: ${coverage}% (target: 95%+)`)
      process.exit(1)
    }

  } catch (e: any) {
    console.error('Fatal error:', e.message.substring(0, 150))
    process.exit(1)
  }
}

phase2()
