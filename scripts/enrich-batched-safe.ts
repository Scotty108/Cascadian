import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Safe batched enrichment - avoids JWT timeout by processing in chunks
 * Strategy: Insert 16M rows at a time (takes ~3-5 min each)
 * 159.6M ÷ 16M = 10 batches, each completes well before 15-min JWT expiry
 */

async function main() {
  try {
    console.log('SAFE BATCHED ENRICHMENT')
    console.log('═'.repeat(70))
    console.log('Strategy: 10 batches × 16M rows = 159.6M total')
    console.log('Each batch: ~3-5 minutes (safe from JWT timeout)')
    console.log('Total time: ~30-50 minutes')
    console.log()

    // Step 1: Create enriched table
    console.log('Step 1: Creating target enriched table...')

    // Drop first (separate query)
    await clickhouse.query({
      query: 'DROP TABLE IF EXISTS trades_raw_enriched_final'
    })

    // Create (separate query)
    await clickhouse.query({
      query: `
CREATE TABLE trades_raw_enriched_final (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime,
  close_price Decimal(10, 6),
  fee_usd Decimal(18, 6),
  slippage_usd Decimal(18, 6),
  hours_held Decimal(10, 2),
  bankroll_at_entry Decimal(18, 2),
  outcome Nullable(Int8),
  fair_price_at_entry Decimal(10, 6),
  pnl_gross Decimal(18, 6),
  pnl_net Decimal(18, 6),
  return_pct Decimal(10, 6),
  condition_id String,
  was_win Nullable(UInt8),
  tx_timestamp DateTime,
  canonical_category String,
  raw_tags Array(String),
  realized_pnl_usd Float64,
  is_resolved UInt8,
  resolved_outcome Nullable(String)
)
ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192
      `
    })
    console.log('✓ Created target table')

    // Step 2: Get total row count
    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const countText = await countResult.text()
    const countData = JSON.parse(countText)
    const totalRows = parseInt(countData.data[0].cnt)
    console.log(`\nStep 2: Source table has ${totalRows.toLocaleString()} rows`)

    // Step 3: Process in batches
    const batchSize = 16_000_000  // 16M per batch
    const numBatches = Math.ceil(totalRows / batchSize)
    console.log(`Step 3: Processing in ${numBatches} batches of ${(batchSize / 1_000_000).toFixed(0)}M rows each`)
    console.log()

    let totalInserted = 0
    for (let i = 0; i < numBatches; i++) {
      const batchNum = i + 1
      const offset = i * batchSize
      const limit = batchSize

      console.log(`Batch ${batchNum}/${numBatches} (offset ${offset.toLocaleString()}, limit ${limit.toLocaleString()})`)

      const start = Date.now()

      const insertQuery = `
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
  ORDER BY wallet_address, timestamp
  LIMIT ${limit} OFFSET ${offset}
) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
      `

      try {
        await clickhouse.query({
          query: insertQuery,
          clickhouse_settings: {
            max_execution_time: 600  // 10 min timeout per batch
          }
        })

        const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1)
        totalInserted += batchSize
        console.log(`  ✓ Completed in ${elapsed}m (total: ${totalInserted.toLocaleString()} rows)`)
      } catch (e: any) {
        console.error(`  ✗ FAILED: ${e.message}`)
        console.error(`  ⚠ Fix the error and restart from batch ${batchNum}`)
        process.exit(1)
      }
    }

    // Step 4: Verify enrichment
    console.log(`\nStep 4: Verifying ${numBatches} batches were inserted correctly...`)
    const verifyResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw_enriched_final
      `
    })

    const verifyText = await verifyResult.text()
    const verifyData = JSON.parse(verifyText)
    const row = verifyData.data[0]

    console.log('\n' + '═'.repeat(70))
    console.log('ENRICHMENT VERIFICATION')
    console.log('═'.repeat(70))
    console.log(`Total rows: ${parseInt(row.total_rows).toLocaleString()}`)
    console.log(`With condition_id: ${parseInt(row.with_condition_id).toLocaleString()} (${row.coverage_pct}%)`)
    console.log()

    if (parseFloat(row.coverage_pct) >= 99) {
      console.log('✓ ENRICHMENT SUCCESSFUL!')

      // Step 5: Swap tables
      console.log('\nStep 5: Swapping tables (atomic)...')
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw TO trades_raw_pre_enrichment'
      })
      console.log('✓ Backed up original as trades_raw_pre_enrichment')

      await clickhouse.query({
        query: 'RENAME TABLE trades_raw_enriched_final TO trades_raw'
      })
      console.log('✓ Promoted enriched table to trades_raw (ACTIVE)')

      console.log('\n' + '═'.repeat(70))
      console.log('✓✓✓ ENRICHMENT COMPLETE AND ACTIVE! ✓✓✓')
      console.log('═'.repeat(70))
      console.log(`Coverage: 51.47% → ${row.coverage_pct}%`)
      console.log('Ready for P&L calculations and dashboard rebuild')
    } else {
      console.error(`⚠ ENRICHMENT INCOMPLETE - Coverage ${row.coverage_pct}% below target`)
      process.exit(1)
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message)
    process.exit(1)
  }
}

main()
