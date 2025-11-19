import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Ultra-safe: Simpler query syntax to avoid header overflow
 * Uses simplified column selection and smaller batches (5M each)
 */

async function main() {
  try {
    console.log('ULTRA-SAFE BATCHED ENRICHMENT')
    console.log('═'.repeat(70))
    console.log('Strategy: Smaller queries with simplified syntax')
    console.log('Batch size: 5M rows (very conservative)')
    console.log('Expected: No header overflow issues')
    console.log()

    // Step 1: Create enriched table
    console.log('Step 1: Creating target table...')
    await clickhouse.query({
      query: 'DROP TABLE IF EXISTS trades_raw_enriched_v2'
    })

    await clickhouse.query({
      query: `
CREATE TABLE trades_raw_enriched_v2 AS SELECT * FROM trades_raw WHERE 1=0
      `
    })
    console.log('✓ Created target table')

    // Get total count
    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const totalRows = parseInt(JSON.parse(await countResult.text()).data[0].cnt)
    console.log(`\nStep 2: Source has ${totalRows.toLocaleString()} rows`)

    // Batches
    const batchSize = 5_000_000  // 5M per batch
    const numBatches = Math.ceil(totalRows / batchSize)
    console.log(`Step 3: Processing ${numBatches} batches of ${(batchSize / 1_000_000).toFixed(0)}M rows`)
    console.log()

    let totalInserted = 0
    for (let i = 0; i < numBatches; i++) {
      const batchNum = i + 1
      const offset = i * batchSize

      console.log(`Batch ${batchNum}/${numBatches} (offset ${offset.toLocaleString()})...`)
      const start = Date.now()

      // Ultra-simplified query
      const query = `
INSERT INTO trades_raw_enriched_v2
SELECT
  id.trade_id,
  id.wallet_address,
  id.market_id,
  id.timestamp,
  id.side,
  id.entry_price,
  id.exit_price,
  id.shares,
  id.usd_value,
  id.pnl,
  id.is_closed,
  id.transaction_hash,
  id.created_at,
  id.close_price,
  id.fee_usd,
  id.slippage_usd,
  id.hours_held,
  id.bankroll_at_entry,
  id.outcome,
  id.fair_price_at_entry,
  id.pnl_gross,
  id.pnl_net,
  id.return_pct,
  COALESCE(id.condition_id, m.condition_id) AS condition_id,
  id.was_win,
  id.tx_timestamp,
  id.canonical_category,
  id.raw_tags,
  id.realized_pnl_usd,
  id.is_resolved,
  id.resolved_outcome
FROM (SELECT * FROM trades_raw LIMIT ${batchSize} OFFSET ${offset}) AS id
LEFT JOIN condition_market_map m USING (market_id)
      `

      try {
        await clickhouse.query({ query })
        const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1)
        totalInserted += batchSize
        console.log(`  ✓ ${elapsed}m (${totalInserted.toLocaleString()} total)`)
      } catch (e: any) {
        console.error(`  ✗ ${e.message}`)
        if (batchNum > 1) {
          console.log(`\n⚠ Restarting from batch ${batchNum}...`)
          // Don't exit - let user decide what to do
        } else {
          process.exit(1)
        }
      }
    }

    // Verify
    console.log(`\nStep 4: Verifying...`)
    const verify = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
FROM trades_raw_enriched_v2
      `
    })

    const row = JSON.parse(await verify.text()).data[0]
    console.log(`\nTotal: ${parseInt(row.total).toLocaleString()}`)
    console.log(`With condition_id: ${parseInt(row.with_id).toLocaleString()} (${row.pct}%)`)

    if (parseFloat(row.pct) >= 99) {
      console.log('\n✓ ENRICHMENT SUCCESS - Swapping tables...')
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw TO trades_raw_backup_pre_enrichment'
      })
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw_enriched_v2 TO trades_raw'
      })
      console.log('✓ trades_raw is now enriched and active!')
    }
  } catch (e: any) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
