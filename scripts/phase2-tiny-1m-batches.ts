import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * PHASE 2: Aggressive continuation with 1M batches
 *
 * Start from 118.9M and push to 159.6M using 1M batches
 * Much smaller = much safer with HTTP API limits
 */

async function phase2() {
  try {
    console.log('PHASE 2: 1M BATCH CONTINUATION (118.9M → 159.6M)')
    console.log('═'.repeat(70))

    const startOffset = 118_913_053
    const totalTarget = 159_574_259
    const remaining = totalTarget - startOffset

    console.log(`Starting from: ${startOffset.toLocaleString()} rows`)
    console.log(`Target: ${totalTarget.toLocaleString()} rows`)
    console.log(`Remaining: ${remaining.toLocaleString()} rows`)
    console.log()

    const batchSize = 1_000_000  // 1M rows - tiny batches
    const numBatches = Math.ceil(remaining / batchSize)

    console.log(`Processing ${numBatches} batches of ${(batchSize / 1_000_000).toFixed(1)}M rows...`)
    console.log()

    let currentOffset = startOffset
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < numBatches; i++) {
      const batchNum = i + 1
      const offset = currentOffset
      const limit = Math.min(batchSize, totalTarget - offset)

      process.stdout.write(`Batch ${batchNum}/${numBatches} (offset ${(offset / 1_000_000).toFixed(1)}M, ${limit.toLocaleString()} rows)...`)
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
        currentOffset += batchSize
        successCount++
        console.log(` ✓ ${elapsed}s`)
      } catch (e: any) {
        failCount++
        const msg = e.message || ''
        console.log(` ✗`)

        if (msg.includes('Header overflow')) {
          console.log(`  → Hit header overflow at batch ${batchNum}`)
          console.log(`  → Waiting 5 seconds before retry with smaller batch...`)

          // Try with 500K instead
          await new Promise(resolve => setTimeout(resolve, 5000))

          process.stdout.write(`  Retry batch ${batchNum} with 500K rows...`)
          try {
            const smallerLimit = Math.min(500_000, totalTarget - offset)
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
FROM (SELECT * FROM trades_raw LIMIT ${smallerLimit} OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
              `
            })
            currentOffset += smallerLimit
            successCount++
            console.log(` ✓ Retry succeeded`)
          } catch (e2: any) {
            console.log(` ✗ Retry also failed`)
            console.log(`  Error: ${e2.message.substring(0, 100)}`)
            // Keep going anyway
          }
        } else {
          console.error(`  Error: ${msg.substring(0, 100)}`)
        }
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
    console.log(`Batches succeeded: ${successCount}`)
    console.log(`Batches with issues: ${failCount}`)
    console.log()

    if (totalRows === 159_574_259) {
      console.log('✅ ALL ROWS ENRICHED!')
      console.log(`Coverage improved: 51.47% → ${coverage}%`)
      console.log()

      if (coverage >= 95) {
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
        console.log('Ready for P&L calculations')
      } else {
        console.log(`⚠️  Coverage is ${coverage}% (below 95% target, but all rows present)`)
        console.log('Tables NOT swapped. Check coverage before proceeding.')
      }
    } else {
      console.log(`⚠️  Still short: ${totalRows.toLocaleString()}/${159_574_259.toLocaleString()} rows`)
      console.log(`Missing: ${(159_574_259 - totalRows).toLocaleString()} rows`)
      console.log(`Coverage: ${coverage}%`)
      console.log()
      console.log('Run this script again to continue:')
      console.log(`  npx tsx phase2-tiny-1m-batches.ts`)
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message.substring(0, 200))
    process.exit(1)
  }
}

phase2()
