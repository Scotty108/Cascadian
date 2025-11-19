import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * PHASE 2: Simple offset-based enrichment
 *
 * We know Phase 1 processed ~118.9M rows (50 batches × 2.376M average)
 * Phase 2 continues from offset 118.9M to 159.6M (~40.7M remaining)
 *
 * Avoid complex NOT IN subqueries - just use direct offsets
 */

async function phase2() {
  try {
    console.log('PHASE 2: CONTINUE FROM OFFSET 118.9M')
    console.log('═'.repeat(70))

    // Known starting point from Phase 1
    const phase1Count = 118_913_053
    const totalTarget = 159_574_259
    const remaining = totalTarget - phase1Count

    console.log(`Phase 1 stopped at: ${phase1Count.toLocaleString()} rows`)
    console.log(`Total target: ${totalTarget.toLocaleString()} rows`)
    console.log(`Remaining: ${remaining.toLocaleString()} rows`)
    console.log()

    // Process in 2M batches from offset 118.9M to end
    const batchSize = 2_000_000
    const numBatches = Math.ceil(remaining / batchSize)
    const startOffset = phase1Count

    console.log(`Processing ${numBatches} batches of ${(batchSize / 1_000_000).toFixed(0)}M rows...`)
    console.log()

    let currentOffset = startOffset
    let inserted = 0

    for (let i = 0; i < numBatches; i++) {
      const batchNum = i + 1
      const offset = currentOffset
      const limit = Math.min(batchSize, totalTarget - offset)

      process.stdout.write(`Batch ${batchNum}/${numBatches} (offset ${(offset / 1_000_000).toFixed(1)}M)...`)
      const start = Date.now()

      try {
        // Simple direct insert - no subqueries
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
FROM (SELECT * FROM trades_raw LIMIT ${limit} OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })

        const elapsed = ((Date.now() - start) / 1000).toFixed(0)
        currentOffset += batchSize
        inserted += limit
        console.log(` ✓ ${elapsed}s`)
      } catch (e: any) {
        console.log(` ✗`)
        const msg = e.message || ''
        console.error(`Error: ${msg.substring(0, 80)}`)

        if (msg.includes('Header overflow')) {
          console.log(`Hit API limit at batch ${batchNum}`)
          console.log(`Completed: ${inserted.toLocaleString()} of ${remaining.toLocaleString()} remaining rows`)
          console.log(`Run this script again to continue from offset ${currentOffset.toLocaleString()}`)
          process.exit(1)
        }

        throw e
      }
    }

    // Final verification
    console.log()
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
    if (coverage >= 95 && totalRows === 159574259) {
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
      console.log(`Total: ${totalRows.toLocaleString()}/159,574,259`)
      console.log(`Coverage: ${coverage}% (target: 95%+)`)
      if (totalRows < 159574259) {
        console.log(
          `Missing: ${(159574259 - totalRows).toLocaleString()} rows (run script again to continue)`
        )
      }
      process.exit(1)
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message.substring(0, 200))
    process.exit(1)
  }
}

phase2()
