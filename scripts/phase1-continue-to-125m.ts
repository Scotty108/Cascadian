import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * PHASE 1 CONTINUATION: Continue from 118.9M to 125M target
 * Then immediately trigger Phase 2
 */

async function continueToTarget() {
  try {
    console.log('PHASE 1 CONTINUATION: 118.9M → 125M TARGET')
    console.log('═'.repeat(70))

    // Get current state
    const currentResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched_final'
    })
    const currentCount = parseInt(JSON.parse(await currentResult.text()).data[0].cnt)
    console.log(`Current progress: ${currentCount.toLocaleString()} rows`)

    const targetCount = 125_000_000
    const remaining = targetCount - currentCount

    if (currentCount >= targetCount) {
      console.log('✅ ALREADY AT TARGET!')
      console.log(`Proceeding directly to Phase 2...`)
      return 'PHASE2_READY'
    }

    console.log(`Remaining to target: ${remaining.toLocaleString()} rows`)
    console.log()

    // Calculate batch info
    const batchSize = 2_000_000
    const currentOffset = currentCount
    const numBatchesNeeded = Math.ceil(remaining / batchSize)

    console.log(`Processing ${numBatchesNeeded} batch(es) of ${(batchSize / 1_000_000).toFixed(0)}M rows...`)
    console.log()

    let insertedCount = currentCount
    for (let i = 0; i < numBatchesNeeded; i++) {
      const offset = insertedCount
      const limit = batchSize

      process.stdout.write(
        `Batch ${i + 1}/${numBatchesNeeded} (offset ${(offset / 1_000_000).toFixed(1)}M)...`
      )
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
FROM (SELECT * FROM trades_raw LIMIT ${limit} OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })

        const elapsed = ((Date.now() - start) / 1000).toFixed(0)
        insertedCount += batchSize
        console.log(` ✓ ${elapsed}s`)

        // Check if we've reached target
        if (insertedCount >= targetCount) {
          console.log()
          console.log('✅ TARGET REACHED!')
          break
        }
      } catch (e: any) {
        console.log(` ✗`)
        console.error(`Error: ${e.message.substring(0, 80)}`)
        if (e.message.includes('Header overflow')) {
          console.log('Hit API limit, stopping Phase 1 batches')
          console.log('Remaining rows will be handled by Phase 2')
          break
        }
      }
    }

    // Final check
    const finalResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched_final'
    })
    const finalCount = parseInt(JSON.parse(await finalResult.text()).data[0].cnt)
    const pct = ((finalCount / 159574259) * 100).toFixed(1)

    console.log()
    console.log('═'.repeat(70))
    console.log(`PHASE 1 CHECKPOINT: ${finalCount.toLocaleString()} rows (${pct}%)`)
    console.log()

    if (finalCount >= targetCount) {
      console.log('✅ PHASE 1 TARGET ACHIEVED!')
      console.log('Ready for Phase 2')
      return 'PHASE2_READY'
    } else {
      console.log(`⚠️  Short of target by ${(targetCount - finalCount).toLocaleString()} rows`)
      console.log('Phase 2 will handle remaining rows')
      return 'PHASE2_READY'
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message)
    process.exit(1)
  }
}

continueToTarget()
