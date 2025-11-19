import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Continue enrichment from offset 21.4M
 * Finish the remaining 138.2M rows in 5M batches
 */

async function main() {
  try {
    console.log('CONTINUING ENRICHMENT FROM CHECKPOINT')
    console.log('═'.repeat(70))

    // Check current progress
    const current = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched_final'
    })
    const currentCount = parseInt(JSON.parse(await current.text()).data[0].cnt)
    console.log(`Current progress: ${currentCount.toLocaleString()} rows inserted`)

    const source = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const totalRows = parseInt(JSON.parse(await source.text()).data[0].cnt)
    console.log(`Total to insert: ${totalRows.toLocaleString()} rows`)
    console.log(`Remaining: ${(totalRows - currentCount).toLocaleString()} rows\n`)

    // Continue in 5M batches
    const batchSize = 5_000_000
    let offset = currentCount
    let batchNum = Math.ceil(currentCount / batchSize) + 1

    while (offset < totalRows) {
      console.log(`Batch ${batchNum} (offset ${offset.toLocaleString()})...`)
      const start = Date.now()

      const query = `
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
FROM (SELECT * FROM trades_raw LIMIT ${batchSize} OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
      `

      try {
        await clickhouse.query({ query })
        const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1)
        offset += batchSize
        batchNum++
        console.log(`  ✓ ${elapsed}m (${offset.toLocaleString()} total)\n`)
      } catch (e: any) {
        const msg = e.message
        console.error(`  ✗ ${msg}`)

        // Retry with smaller batch if header overflow
        if (msg.includes('Header overflow')) {
          console.log(`  Retrying with smaller batch (2.5M rows)...`)
          const query2 = `
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
FROM (SELECT * FROM trades_raw LIMIT 2500000 OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
          try {
            await clickhouse.query({ query: query2 })
            offset += 2_500_000
            console.log(`  ✓ Retry succeeded (${offset.toLocaleString()} total)\n`)
          } catch (e2: any) {
            console.error(`  ✗ Retry also failed: ${e2.message}`)
            console.log(`\n⚠ Checkpoint: ${offset.toLocaleString()} rows completed`)
            console.log('Run this script again to continue from this point\n')
            process.exit(1)
          }
        } else {
          throw e
        }
      }
    }

    // Final verification
    console.log(`\nVerifying enrichment...`)
    const verify = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
FROM trades_raw_enriched_final
      `
    })

    const row = JSON.parse(await verify.text()).data[0]
    const coverage = parseFloat(row.pct)

    console.log(`Total: ${parseInt(row.total).toLocaleString()}`)
    console.log(`With condition_id: ${parseInt(row.with_id).toLocaleString()} (${coverage}%)\n`)

    if (coverage >= 99 && parseInt(row.total) === totalRows) {
      console.log('✓ ENRICHMENT COMPLETE - Swapping tables...')
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw TO trades_raw_pre_enrichment'
      })
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw_enriched_final TO trades_raw'
      })
      console.log('\n═'.repeat(70))
      console.log('✓✓✓ ENRICHMENT ACTIVE ✓✓✓')
      console.log('═'.repeat(70))
      console.log(`Coverage: 51.47% → ${coverage}%`)
      console.log('Ready for P&L calculations!')
    } else {
      console.log(
        `⚠ Incomplete: ${parseInt(row.total).toLocaleString()}/${totalRows.toLocaleString()} (${coverage}%)`
      )
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message)
    process.exit(1)
  }
}

main()
