import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Batched enrichment to work around HTTP API header overflow
 * Strategy: Insert in 10M row chunks instead of all 159.6M at once
 * Expected: 51.47% → 98%+ condition_id coverage
 */

async function enrichTradeBatch(startRow: number, endRow: number): Promise<number> {
  try {
    console.log(`\n[Batch ${startRow}-${endRow}] Starting enrichment...`)

    const query = `
INSERT INTO trades_raw
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
  SELECT *
  FROM trades_raw_backup_final
  ORDER BY trade_id
  LIMIT ${endRow - startRow} OFFSET ${startRow}
) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
`

    const result = await clickhouse.query({
      query,
      clickhouse_settings: {
        max_execution_time: 3600  // 1 hour timeout per batch
      }
    })

    const text = await result.text()
    console.log(`[Batch ${startRow}-${endRow}] Result:`, text)
    return endRow - startRow
  } catch (e: any) {
    console.error(`[Batch ${startRow}-${endRow}] Error:`, e.message)
    throw e
  }
}

async function getSourceRowCount(): Promise<number> {
  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const text = await result.text()
    const match = text.match(/(\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch (e: any) {
    console.error('Error getting row count:', e.message)
    throw e
  }
}

async function checkProgress(): Promise<void> {
  try {
    const result = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw
`
    })
    const text = await result.text()
    console.log('\n=== PROGRESS CHECK ===')
    console.log(text)
  } catch (e: any) {
    console.error('Error checking progress:', e.message)
  }
}

async function main() {
  try {
    console.log('Starting batched enrichment...')

    // Step 1: Get row count
    console.log('\n[Step 1] Counting rows in backup...')
    const totalRows = await getBackupRowCount()
    console.log(`Total rows to enrich: ${totalRows.toLocaleString()}`)

    // Step 2: Calculate batches (10M rows per batch)
    const batchSize = 10_000_000
    const numBatches = Math.ceil(totalRows / batchSize)
    console.log(`\n[Step 2] Will process in ${numBatches} batches of ${batchSize.toLocaleString()} rows each`)

    // Step 3: Execute batches sequentially
    console.log(`\n[Step 3] Processing batches...`)
    let totalProcessed = 0

    for (let i = 0; i < numBatches; i++) {
      const startRow = i * batchSize
      const endRow = Math.min(startRow + batchSize, totalRows)
      const batchNum = i + 1

      console.log(`\n╔═══════════════════════════════════════════════════════════╗`)
      console.log(`║ Batch ${batchNum}/${numBatches} (Rows ${startRow.toLocaleString()}-${endRow.toLocaleString()})`)
      console.log(`╚═══════════════════════════════════════════════════════════╝`)

      try {
        await enrichTradeBatch(startRow, endRow)
        totalProcessed += (endRow - startRow)

        // Check progress every 2 batches
        if ((i + 1) % 2 === 0 || i === numBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          await checkProgress()
        }
      } catch (e: any) {
        // If a batch fails, log and continue (don't crash entire process)
        console.error(`Batch ${batchNum} failed, continuing...`)
        if (i === numBatches - 1) {
          throw e  // If last batch fails, throw
        }
      }
    }

    // Step 4: Final verification
    console.log(`\n[Step 4] All batches submitted! Running final verification...`)
    await new Promise(resolve => setTimeout(resolve, 5000))
    await checkProgress()

    console.log(`\n✓ Enrichment complete! Processed ${totalProcessed.toLocaleString()} rows`)
  } catch (e: any) {
    console.error('Fatal error:', e.message)
    process.exit(1)
  }
}

main()
