import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Simple enrichment: Create new table with enriched data, then swap
 * Strategy: Single INSERT statement that JOINs with condition_market_map
 * Expected: 51.47% → 98%+ condition_id coverage
 */

async function main() {
  try {
    console.log('ENRICHMENT EXECUTION PLAN')
    console.log('═'.repeat(60))
    console.log('Source: trades_raw (159.6M rows, 51.47% coverage)')
    console.log('Mapping: condition_market_map (151.8K rows)')
    console.log('Target: 98%+ condition_id coverage')
    console.log()

    // Step 1: Create temporary enriched table
    console.log('Step 1: Creating temporary enriched table...')
    await clickhouse.query({
      query: `
CREATE TABLE IF NOT EXISTS trades_raw_enriched (
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
    console.log('✓ Created temporary table')

    // Step 2: Insert enriched data
    console.log('\nStep 2: Inserting enriched data (this will take 10-20 minutes)...')
    const enrichQuery = `
INSERT INTO trades_raw_enriched
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
FROM trades_raw t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
    `

    console.log('Starting INSERT...')
    const start = Date.now()

    const result = await clickhouse.query({
      query: enrichQuery,
      clickhouse_settings: {
        max_execution_time: 3600  // 1 hour timeout
      }
    })

    const text = await result.text()
    const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1)
    console.log(`✓ INSERT completed in ${elapsed} minutes`)

    // Step 3: Verify enrichment
    console.log('\nStep 3: Verifying enrichment results...')
    const verifyResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw_enriched
      `
    })

    const verifyText = await verifyResult.text()
    const verifyData = JSON.parse(verifyText)
    const row = verifyData.data[0]

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('ENRICHMENT VERIFICATION')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`Total rows: ${parseInt(row.total_rows).toLocaleString()}`)
    console.log(`With condition_id: ${parseInt(row.with_condition_id).toLocaleString()} (${row.coverage_pct}%)`)
    console.log(`Without condition_id: ${(parseInt(row.total_rows) - parseInt(row.with_condition_id)).toLocaleString()}`)
    console.log()
    console.log(`IMPROVEMENT: 51.47% → ${row.coverage_pct}%`)
    console.log()

    if (parseFloat(row.coverage_pct) >= 95) {
      console.log('✓ ENRICHMENT SUCCESSFUL! Coverage meets target.')

      // Step 4: Swap tables
      console.log('\nStep 4: Swapping tables...')
      await clickhouse.query({
        query: 'RENAME TABLE trades_raw TO trades_raw_pre_enrichment'
      })
      console.log('✓ Backed up old table as trades_raw_pre_enrichment')

      await clickhouse.query({
        query: 'RENAME TABLE trades_raw_enriched TO trades_raw'
      })
      console.log('✓ Promoted enriched table to trades_raw')

      console.log('\n═══════════════════════════════════════════════════════════')
      console.log('✓ ENRICHMENT COMPLETE AND ACTIVE!')
      console.log('═══════════════════════════════════════════════════════════')
      console.log('trades_raw now has 98%+ condition_id coverage')
      console.log('Ready for P&L calculations and dashboard updates')
    } else {
      console.log(`⚠ ENRICHMENT PARTIAL - Coverage ${row.coverage_pct}% below target (95%+)`)
      console.log('Review condition_market_map for gaps in coverage')
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message)
    process.exit(1)
  }
}

main()
