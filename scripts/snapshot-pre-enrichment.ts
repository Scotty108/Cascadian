#!/usr/bin/env npx tsx
/**
 * PRE-ENRICHMENT SNAPSHOT - Phase 3 Guard Rail
 *
 * Captures state of all downstream tables before enrichment begins.
 * Used for verification and rollback if needed.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

async function snapshotPreEnrichment() {
  const client = getClickHouseClient()

  console.log('\n📊 Phase 3: Pre-Enrichment Snapshot\n')
  console.log('Capturing state of downstream tables before enrichment...\n')

  const snapshot: any = {
    timestamp: new Date().toISOString(),
    phase: 'pre-enrichment',
    tables: {}
  }

  try {
    // 1. trades_raw (note: no block_number field, trades_raw uses block_time)
    console.log('📋 Snapshot: trades_raw')
    const tradesResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_time) as min_block_time,
          max(block_time) as max_block_time,
          countIf(block_time = toDateTime(0)) as zero_timestamps,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT market_id) as unique_markets
        FROM default.trades_raw
      `,
      format: 'JSONEachRow'
    })
    const tradesData = await tradesResult.json<any>()
    snapshot.tables.trades_raw = tradesData[0]
    console.log(JSON.stringify(tradesData[0], null, 2))

    // 2. Check trades in recovered date range (use block_time)
    console.log('\n📋 Snapshot: trades_raw (recovered date range)')
    const tradesRecoveredResult = await client.query({
      query: `
        SELECT
          count() as rows_in_range,
          countIf(block_time = toDateTime(0)) as zero_timestamps_in_range,
          min(block_time) as min_block_time,
          max(block_time) as max_block_time
        FROM default.trades_raw
        WHERE block_time >= '2022-12-01' AND block_time <= '2025-10-31'
      `,
      format: 'JSONEachRow'
    })
    const tradesRecovered = await tradesRecoveredResult.json<any>()
    snapshot.tables.trades_raw_recovered_range = tradesRecovered[0]
    console.log(JSON.stringify(tradesRecovered[0], null, 2))

    // 3. wallet_metrics_complete
    console.log('\n📋 Snapshot: wallet_metrics_complete')
    const walletMetricsResult = await client.query({
      query: `
        SELECT
          count() as total_wallets,
          sum(total_trades) as sum_total_trades,
          min(first_trade_date) as earliest_trade,
          max(last_trade_date) as latest_trade,
          sum(total_volume) as sum_volume
        FROM default.wallet_metrics_complete
      `,
      format: 'JSONEachRow'
    })
    const walletMetrics = await walletMetricsResult.json<any>()
    snapshot.tables.wallet_metrics_complete = walletMetrics[0]
    console.log(JSON.stringify(walletMetrics[0], null, 2))

    // 4. Find affected wallets (traded in recovered date range)
    console.log('\n📋 Snapshot: Affected wallets count')
    const affectedWalletsResult = await client.query({
      query: `
        SELECT count(DISTINCT wallet) as affected_wallets
        FROM default.trades_raw
        WHERE block_time >= '2022-12-01' AND block_time <= '2025-10-31'
      `,
      format: 'JSONEachRow'
    })
    const affectedWallets = await affectedWalletsResult.json<any>()
    snapshot.affected_wallets = affectedWallets[0]
    console.log(JSON.stringify(affectedWallets[0], null, 2))

    // 5. market_resolutions_final
    console.log('\n📋 Snapshot: market_resolutions_final')
    const resolutionsResult = await client.query({
      query: `
        SELECT
          count() as total_resolutions,
          min(resolved_at) as earliest_resolution,
          max(resolved_at) as latest_resolution
        FROM default.market_resolutions_final
      `,
      format: 'JSONEachRow'
    })
    const resolutions = await resolutionsResult.json<any>()
    snapshot.tables.market_resolutions_final = resolutions[0]
    console.log(JSON.stringify(resolutions[0], null, 2))

    // Save snapshot to file
    const snapshotPath = 'docs/recovery/pre_enrichment_snapshot.json'
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))

    console.log('\n✅ Pre-enrichment snapshot complete!')
    console.log(`📄 Saved to: ${snapshotPath}`)
    console.log('')
    console.log('Key Findings:')
    console.log(`  - trades_raw: ${Number(tradesData[0].total_rows).toLocaleString()} rows`)
    console.log(`  - Trades in recovered range: ${Number(tradesRecovered[0].rows_in_range).toLocaleString()} rows`)
    console.log(`  - Zero timestamps in range: ${Number(tradesRecovered[0].zero_timestamps_in_range).toLocaleString()}`)
    console.log(`  - Affected wallets: ${Number(affectedWallets[0].affected_wallets).toLocaleString()}`)
    console.log(`  - market_resolutions: ${Number(resolutions[0].total_resolutions).toLocaleString()} resolved`)
    console.log('')

  } catch (error: any) {
    console.error('\n❌ Snapshot failed:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

snapshotPreEnrichment().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  process.exit(1)
})
