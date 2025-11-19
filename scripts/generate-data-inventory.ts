#!/usr/bin/env npx tsx
/**
 * DATA INVENTORY REPORT GENERATOR
 * Produces comprehensive snapshot of all major datasets with row counts,
 * unique dimensions, upstream sources, and downstream consumers.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

interface DatasetMetrics {
  dataset: string
  table: string
  rowCount: string
  uniqueDimensions: Record<string, string>
  upstreamSource: string
  downstreamConsumers: string[]
}

async function generateInventory() {
  const client = getClickHouseClient()
  console.log('\n📊 Generating Data Inventory Report...\n')

  const inventory: Record<string, DatasetMetrics> = {}

  try {
    // ========================================
    // DATASET 1: WALLETS
    // ========================================
    console.log('📦 Dataset 1: Wallets')

    // clob_fills wallet counts
    const clobWalletsResult = await client.query({
      query: `
        SELECT
          count() as total_fills,
          uniq(proxy_wallet) as unique_proxy_wallets,
          uniq(user_eoa) as unique_user_eoas,
          uniq(coalesce(proxy_wallet, user_eoa)) as unique_combined_wallets
        FROM default.clob_fills
      `,
      format: 'JSONEachRow'
    })
    const clobWallets = await clobWalletsResult.json<any>()

    // wallet_ui_map counts
    const walletMapResult = await client.query({
      query: `
        SELECT
          count() as total_mappings,
          uniq(proxy_wallet) as unique_proxy_wallets,
          uniq(ui_wallet) as unique_ui_wallets
        FROM default.wallet_ui_map
      `,
      format: 'JSONEachRow'
    })
    const walletMap = await walletMapResult.json<any>()

    inventory.wallets = {
      dataset: 'Wallets',
      table: 'clob_fills + wallet_ui_map',
      rowCount: `${clobWallets[0].total_fills} fills, ${walletMap[0].total_mappings} mappings`,
      uniqueDimensions: {
        unique_proxy_wallets: clobWallets[0].unique_proxy_wallets,
        unique_user_eoas: clobWallets[0].unique_user_eoas,
        unique_combined: clobWallets[0].unique_combined_wallets,
        mapped_proxies: walletMap[0].unique_proxy_wallets,
        mapped_ui_wallets: walletMap[0].unique_ui_wallets
      },
      upstreamSource: 'Goldsky CLOB API (clob_fills), Polymarket operator events',
      downstreamConsumers: ['wallet_metrics_complete', 'leaderboard views', 'smart money tracking']
    }
    console.log('  ✅ Wallets: %s total fills, %s unique wallets',
      clobWallets[0].total_fills, clobWallets[0].unique_combined_wallets)

    // ========================================
    // DATASET 2: TRADES / FILLS
    // ========================================
    console.log('\n📦 Dataset 2: Trades/Fills')

    const tradesResult = await client.query({
      query: `
        SELECT
          count() as total_fills,
          uniq(asset_id) as unique_condition_ids,
          uniq(market_slug) as unique_markets,
          min(timestamp) as earliest_fill,
          max(timestamp) as latest_fill
        FROM default.clob_fills
      `,
      format: 'JSONEachRow'
    })
    const trades = await tradesResult.json<any>()

    inventory.trades = {
      dataset: 'Trades/Fills',
      table: 'clob_fills',
      rowCount: trades[0].total_fills,
      uniqueDimensions: {
        unique_condition_ids: trades[0].unique_condition_ids,
        unique_markets: trades[0].unique_markets,
        date_range: `${trades[0].earliest_fill} → ${trades[0].latest_fill}`
      },
      upstreamSource: 'Goldsky CLOB API (order book fills)',
      downstreamConsumers: ['vw_trades_canonical', 'trades_raw view', 'wallet_pnl_summary']
    }
    console.log('  ✅ Trades: %s fills, %s unique condition IDs',
      trades[0].total_fills, trades[0].unique_condition_ids)

    // ========================================
    // DATASET 3: MARKETS / EVENTS
    // ========================================
    console.log('\n📦 Dataset 3: Markets/Events')

    // gamma_markets
    const gammaMarketsResult = await client.query({
      query: `
        SELECT
          count() as total_markets,
          uniq(condition_id) as unique_condition_ids,
          uniq(question) as unique_questions,
          countIf(closed = true) as closed_markets,
          countIf(archived = true) as archived_markets
        FROM default.gamma_markets
      `,
      format: 'JSONEachRow'
    })
    const gammaMarkets = await gammaMarketsResult.json<any>()

    // Check for Dome metadata tables
    const domeTablesResult = await client.query({
      query: `
        SELECT name, total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%dome%' OR name LIKE '%metadata%' OR name LIKE '%dim_market%')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const domeTables = await domeTablesResult.json<any>()

    const domeTablesSummary = domeTables.length > 0
      ? domeTables.map((t: any) => `${t.name} (${t.total_rows} rows)`).join(', ')
      : 'None found'

    inventory.markets = {
      dataset: 'Markets/Events',
      table: 'gamma_markets',
      rowCount: gammaMarkets[0].total_markets,
      uniqueDimensions: {
        unique_condition_ids: gammaMarkets[0].unique_condition_ids,
        unique_questions: gammaMarkets[0].unique_questions,
        closed_markets: gammaMarkets[0].closed_markets,
        archived_markets: gammaMarkets[0].archived_markets,
        dome_metadata_tables: domeTablesSummary
      },
      upstreamSource: 'Gamma API (markets endpoint), Dome API (metadata)',
      downstreamConsumers: ['market detail pages', 'market screener', 'resolution tracking']
    }
    console.log('  ✅ Markets: %s total, %s closed, %s archived',
      gammaMarkets[0].total_markets, gammaMarkets[0].closed_markets, gammaMarkets[0].archived_markets)

    // ========================================
    // DATASET 4: RESOLUTIONS / OUTCOMES
    // ========================================
    console.log('\n📦 Dataset 4: Resolutions/Outcomes')

    // gamma_resolved
    const gammaResolvedResult = await client.query({
      query: `
        SELECT
          count() as total_resolutions,
          uniq(cid) as unique_condition_ids,
          min(fetched_at) as earliest_fetch,
          max(fetched_at) as latest_fetch
        FROM default.gamma_resolved
      `,
      format: 'JSONEachRow'
    })
    const gammaResolved = await gammaResolvedResult.json<any>()

    // Check for market_resolutions_final
    const marketResolutionsResult = await client.query({
      query: `
        SELECT count() as total_rows
        FROM system.tables
        WHERE database = 'default' AND name = 'market_resolutions_final'
      `,
      format: 'JSONEachRow'
    })
    const hasMarketResolutions = (await marketResolutionsResult.json<any>())[0]?.total_rows > 0

    let marketResolutionsCount = 'N/A'
    if (hasMarketResolutions) {
      const mrfResult = await client.query({
        query: `SELECT count() as total_rows FROM default.market_resolutions_final`,
        format: 'JSONEachRow'
      })
      const mrfData = await mrfResult.json<any>()
      marketResolutionsCount = mrfData[0].total_rows
    }

    inventory.resolutions = {
      dataset: 'Resolutions/Outcomes',
      table: 'gamma_resolved',
      rowCount: gammaResolved[0].total_resolutions,
      uniqueDimensions: {
        unique_condition_ids: gammaResolved[0].unique_condition_ids,
        fetch_date_range: `${gammaResolved[0].earliest_fetch} → ${gammaResolved[0].latest_fetch}`,
        market_resolutions_final: marketResolutionsCount
      },
      upstreamSource: 'Gamma API (resolved endpoint)',
      downstreamConsumers: ['PnL calculations', 'wallet performance metrics', 'market outcome display']
    }
    console.log('  ✅ Resolutions: %s from gamma_resolved',
      gammaResolved[0].total_resolutions)

    // ========================================
    // DATASET 5: SETTLEMENTS (ERC-1155)
    // ========================================
    console.log('\n📦 Dataset 5: Settlements (ERC-1155)')

    const erc1155Result = await client.query({
      query: `
        SELECT
          count() as total_transfers,
          uniq(tx_hash) as unique_transactions,
          uniq(from_address) as unique_from_addresses,
          uniq(to_address) as unique_to_addresses,
          min(block_number) as min_block,
          max(block_number) as max_block,
          countIf(block_timestamp = toDateTime(0)) as zero_timestamps
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    })
    const erc1155 = await erc1155Result.json<any>()

    const blockTimestampsResult = await client.query({
      query: `
        SELECT
          count() as total_blocks,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.tmp_block_timestamps
      `,
      format: 'JSONEachRow'
    })
    const blockTimestamps = await blockTimestampsResult.json<any>()

    inventory.settlements = {
      dataset: 'Settlements (ERC-1155)',
      table: 'erc1155_transfers + tmp_block_timestamps',
      rowCount: `${erc1155[0].total_transfers} transfers, ${blockTimestamps[0].total_blocks} block timestamps`,
      uniqueDimensions: {
        unique_transactions: erc1155[0].unique_transactions,
        unique_from_addresses: erc1155[0].unique_from_addresses,
        unique_to_addresses: erc1155[0].unique_to_addresses,
        block_range: `${erc1155[0].min_block} → ${erc1155[0].max_block}`,
        timestamp_quality: `${erc1155[0].zero_timestamps} zeros / ${erc1155[0].total_transfers} (${((erc1155[0].zero_timestamps / erc1155[0].total_transfers) * 100).toFixed(6)}%)`
      },
      upstreamSource: 'Alchemy Transfers API (ERC-1155 events)',
      downstreamConsumers: ['Future: token balance tracking', 'Future: redemption analysis', 'Currently: self-contained']
    }
    console.log('  ✅ Settlements: %s transfers, %s block timestamps',
      erc1155[0].total_transfers, blockTimestamps[0].total_blocks)

    // ========================================
    // SUMMARY COUNTS
    // ========================================
    console.log('\n📊 Summary Snapshot (as of 2025-11-11):')
    console.log('  • Markets: %s total', gammaMarkets[0].total_markets)
    console.log('  • Events/Outcomes: %s condition IDs', gammaMarkets[0].unique_condition_ids)
    console.log('  • Wallets: %s unique', clobWallets[0].unique_combined_wallets)
    console.log('  • Resolutions: %s resolved markets', gammaResolved[0].total_resolutions)
    console.log('  • Fills: %s trade fills', trades[0].total_fills)
    console.log('  • Settlements: %s ERC-1155 transfers', erc1155[0].total_transfers)

    // ========================================
    // SAVE TO JSON
    // ========================================
    const report = {
      generated_at: new Date().toISOString(),
      datasets: inventory,
      summary: {
        markets: gammaMarkets[0].total_markets,
        condition_ids: gammaMarkets[0].unique_condition_ids,
        wallets: clobWallets[0].unique_combined_wallets,
        resolutions: gammaResolved[0].total_resolutions,
        fills: trades[0].total_fills,
        erc1155_transfers: erc1155[0].total_transfers
      }
    }

    console.log('\n✅ Data inventory complete!')
    console.log('📁 Saving to: data_inventory_raw.json')

    // Write to file for report generation
    const fs = require('fs')
    fs.writeFileSync('data_inventory_raw.json', JSON.stringify(report, null, 2))

    return report

  } catch (error: any) {
    console.error('\n❌ Error generating inventory:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

generateInventory().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  process.exit(1)
})
