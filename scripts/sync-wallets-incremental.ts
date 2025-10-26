#!/usr/bin/env npx tsx
/**
 * Incremental Wallet Trade Sync
 *
 * Syncs only NEW trades since last sync for each wallet.
 * Designed to run as a cron job for keeping data up-to-date.
 *
 * Strategy:
 * - Fetch only trades newer than `last_trade_timestamp` for each wallet
 * - Prioritize active wallets (recent trades) with more frequent syncs
 * - Update sync metadata with new last_trade_timestamp
 * - Re-calculate category omega for affected wallets
 *
 * Usage:
 *   # Sync all wallets with new trades
 *   npx tsx scripts/sync-wallets-incremental.ts
 *
 *   # Sync top 100 wallets by omega (hourly cron)
 *   npx tsx scripts/sync-wallets-incremental.ts --top 100
 *
 *   # Sync only wallets with trades in last 24 hours
 *   npx tsx scripts/sync-wallets-incremental.ts --active-only
 *
 *   # Dry run to see what would be synced
 *   npx tsx scripts/sync-wallets-incremental.ts --dry-run
 *
 * Cron Schedule Examples:
 *   # Every hour for top 100 wallets
 *   0 * * * * cd /path/to/app && npx tsx scripts/sync-wallets-incremental.ts --top 100
 *
 *   # Every 6 hours for all wallets
 *   0 */6 * * * cd /path/to/app && npx tsx scripts/sync-wallets-incremental.ts
 *
 *   # Daily full sync
 *   0 2 * * * cd /path/to/app && npx tsx scripts/sync-wallets-incremental.ts --all
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createSupabaseClient } from '@/lib/sync/wallet-trade-sync-utils'
import { fetchWalletTrades, OrderFilledEvent } from '@/lib/goldsky/client'
import {
  processTradeForWallet,
  insertTradesIntoClickHouse,
  updateSyncMetadata,
  getSyncMetadata,
  ProcessedTrade,
} from '@/lib/sync/wallet-trade-sync-utils'

interface IncrementalSyncConfig {
  topN?: number // Only sync top N wallets by omega
  activeOnly: boolean // Only sync wallets with recent activity
  dryRun: boolean
  recalculateOmega: boolean // Re-calculate category omega after sync
  minHoursSinceLastSync: number // Minimum hours since last sync
}

interface WalletToSync {
  wallet_address: string
  omega_ratio: number | null
  last_synced_at: Date | null
  last_trade_timestamp: Date | null
}

/**
 * Fetch incremental trades for a wallet (only new trades since last sync)
 */
async function fetchIncrementalTrades(
  walletAddress: string,
  lastTradeTimestamp: Date | null
): Promise<OrderFilledEvent[]> {
  // Fetch all trades (Goldsky doesn't support timestamp filtering directly)
  // We'll filter client-side
  const allTrades = await fetchWalletTrades(walletAddress, 1000, 0)

  if (!lastTradeTimestamp) {
    return allTrades
  }

  // Filter to only trades newer than last sync
  const lastSyncUnix = Math.floor(lastTradeTimestamp.getTime() / 1000)
  const newTrades = allTrades.filter((trade) => parseInt(trade.timestamp) > lastSyncUnix)

  return newTrades
}

/**
 * Sync incremental trades for a wallet
 */
async function syncWalletIncremental(
  wallet: WalletToSync,
  supabase: ReturnType<typeof createSupabaseClient>,
  verbose: boolean = false
): Promise<{ success: boolean; newTrades: number; error?: string }> {
  const startTime = Date.now()

  if (verbose) {
    console.log(`\n🔄 Syncing incremental trades for: ${wallet.wallet_address}`)
    if (wallet.last_trade_timestamp) {
      console.log(`   Last synced trade: ${wallet.last_trade_timestamp.toISOString()}`)
    }
  }

  try {
    // Mark as syncing
    await updateSyncMetadata(
      {
        wallet_address: wallet.wallet_address,
        sync_status: 'syncing',
        total_trades_synced: 0,
        total_trades_processed: 0,
        error_count: 0,
        sync_duration_ms: 0,
        trades_per_second: 0,
      },
      supabase
    )

    // Fetch incremental trades
    if (verbose) {
      console.log('   📡 Fetching new trades from Goldsky...')
    }

    const newTrades = await fetchIncrementalTrades(
      wallet.wallet_address,
      wallet.last_trade_timestamp
    )

    if (verbose) {
      console.log(`   ✅ Found ${newTrades.length} new trades`)
    }

    if (newTrades.length === 0) {
      // No new trades - update metadata and return
      const metadata = await getSyncMetadata(wallet.wallet_address, supabase)
      await updateSyncMetadata(
        {
          wallet_address: wallet.wallet_address,
          sync_status: 'completed',
          total_trades_synced: metadata?.total_trades_synced || 0,
          total_trades_processed: metadata?.total_trades_processed || 0,
          last_synced_at: new Date(),
          error_count: 0,
          sync_duration_ms: Date.now() - startTime,
          trades_per_second: 0,
          last_trade_timestamp: wallet.last_trade_timestamp,
        },
        supabase
      )

      if (verbose) {
        console.log(`   ⏭️  No new trades, skipping`)
      }

      return { success: true, newTrades: 0 }
    }

    // Process trades
    if (verbose) {
      console.log('   🔄 Processing trades...')
    }

    const processedTrades: ProcessedTrade[] = []

    for (const trade of newTrades) {
      const processed = await processTradeForWallet(trade, wallet.wallet_address, supabase)
      if (processed) {
        processedTrades.push(processed)
      }
    }

    if (verbose) {
      console.log(`   ✅ Processed ${processedTrades.length} valid trades`)
    }

    // Insert into ClickHouse
    if (processedTrades.length > 0) {
      if (verbose) {
        console.log(`   📥 Inserting ${processedTrades.length} trades into ClickHouse...`)
      }

      const insertResult = await insertTradesIntoClickHouse(processedTrades)

      if (!insertResult.success) {
        throw new Error(`Failed to insert trades: ${insertResult.error}`)
      }
    }

    // Get new last trade timestamp
    const newLastTradeTimestamp =
      processedTrades.length > 0
        ? processedTrades.reduce((latest, trade) =>
            trade.timestamp > latest ? trade.timestamp : latest
          , processedTrades[0].timestamp)
        : wallet.last_trade_timestamp

    // Get previous totals
    const prevMetadata = await getSyncMetadata(wallet.wallet_address, supabase)
    const totalTradesSynced = (prevMetadata?.total_trades_synced || 0) + processedTrades.length
    const totalTradesProcessed = (prevMetadata?.total_trades_processed || 0) + newTrades.length

    // Update metadata
    const duration = Date.now() - startTime
    await updateSyncMetadata(
      {
        wallet_address: wallet.wallet_address,
        sync_status: 'completed',
        total_trades_synced: totalTradesSynced,
        total_trades_processed: totalTradesProcessed,
        last_synced_at: new Date(),
        error_count: 0,
        sync_duration_ms: duration,
        trades_per_second: processedTrades.length / (duration / 1000),
        last_trade_timestamp: newLastTradeTimestamp,
      },
      supabase
    )

    if (verbose) {
      console.log(`   ✅ Incremental sync complete! (${(duration / 1000).toFixed(1)}s)`)
    }

    return { success: true, newTrades: processedTrades.length }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const duration = Date.now() - startTime

    // Get previous error count
    const prevMetadata = await getSyncMetadata(wallet.wallet_address, supabase)
    const errorCount = (prevMetadata?.error_count || 0) + 1

    // Update metadata as failed
    await updateSyncMetadata(
      {
        wallet_address: wallet.wallet_address,
        sync_status: 'failed',
        total_trades_synced: prevMetadata?.total_trades_synced || 0,
        total_trades_processed: prevMetadata?.total_trades_processed || 0,
        last_error: errorMessage,
        error_count: errorCount,
        sync_duration_ms: duration,
        trades_per_second: 0,
      },
      supabase
    )

    if (verbose) {
      console.error(`   ❌ Sync failed: ${errorMessage}`)
    }

    return { success: false, newTrades: 0, error: errorMessage }
  }
}

/**
 * Fetch wallets that need incremental sync
 */
async function fetchWalletsNeedingSync(
  config: IncrementalSyncConfig,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<WalletToSync[]> {
  // Build query
  let query = supabase
    .from('wallet_scores')
    .select(
      `
      wallet_address,
      omega_ratio,
      wallet_sync_metadata (
        last_synced_at,
        last_trade_timestamp
      )
    `
    )
    .order('omega_ratio', { ascending: false, nullsFirst: false })

  if (config.topN) {
    query = query.limit(config.topN)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch wallets: ${error.message}`)
  }

  if (!data) {
    return []
  }

  // Transform and filter
  const wallets: WalletToSync[] = []
  const minLastSyncTime = new Date(Date.now() - config.minHoursSinceLastSync * 60 * 60 * 1000)

  for (const row of data) {
    const metadata = Array.isArray(row.wallet_sync_metadata)
      ? row.wallet_sync_metadata[0]
      : row.wallet_sync_metadata

    const lastSyncedAt = metadata?.last_synced_at ? new Date(metadata.last_synced_at) : null
    const lastTradeTimestamp = metadata?.last_trade_timestamp
      ? new Date(metadata.last_trade_timestamp)
      : null

    // Skip if synced too recently
    if (lastSyncedAt && lastSyncedAt > minLastSyncTime) {
      continue
    }

    // If activeOnly, skip wallets without recent trades
    if (config.activeOnly) {
      if (!lastTradeTimestamp || Date.now() - lastTradeTimestamp.getTime() > 24 * 60 * 60 * 1000) {
        continue
      }
    }

    wallets.push({
      wallet_address: row.wallet_address,
      omega_ratio: row.omega_ratio,
      last_synced_at: lastSyncedAt,
      last_trade_timestamp: lastTradeTimestamp,
    })
  }

  return wallets
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  const config: IncrementalSyncConfig = {
    activeOnly: false,
    dryRun: false,
    recalculateOmega: true,
    minHoursSinceLastSync: 1, // At least 1 hour between syncs
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--top':
        config.topN = parseInt(args[++i])
        break
      case '--active-only':
        config.activeOnly = true
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--no-recalculate':
        config.recalculateOmega = false
        break
      case '--min-hours':
        config.minHoursSinceLastSync = parseInt(args[++i])
        break
      case '--all':
        config.topN = undefined
        break
      case '--help':
        console.log(`
Incremental Wallet Trade Sync

Syncs only new trades since last sync for each wallet.
Designed to run as a cron job.

Usage:
  npx tsx scripts/sync-wallets-incremental.ts [options]

Options:
  --top N             Only sync top N wallets by omega
  --active-only       Only sync wallets with recent trades
  --dry-run           Show what would be synced without syncing
  --no-recalculate    Skip omega recalculation after sync
  --min-hours N       Minimum hours since last sync (default: 1)
  --all               Sync all wallets (no limit)
  --help              Show this help message

Examples:
  # Sync top 100 wallets (hourly cron)
  npx tsx scripts/sync-wallets-incremental.ts --top 100

  # Sync only active wallets
  npx tsx scripts/sync-wallets-incremental.ts --active-only

  # Full incremental sync (daily cron)
  npx tsx scripts/sync-wallets-incremental.ts --all

  # Dry run
  npx tsx scripts/sync-wallets-incremental.ts --top 10 --dry-run
        `)
        process.exit(0)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('🔄 INCREMENTAL WALLET TRADE SYNC')
  console.log('='.repeat(80))
  console.log('\nConfiguration:')
  console.log(`  Top N: ${config.topN || 'all'}`)
  console.log(`  Active only: ${config.activeOnly}`)
  console.log(`  Dry run: ${config.dryRun}`)
  console.log(`  Recalculate omega: ${config.recalculateOmega}`)
  console.log(`  Min hours since last sync: ${config.minHoursSinceLastSync}`)

  const supabase = createSupabaseClient()

  // Fetch wallets needing sync
  console.log('\n📊 Fetching wallets needing sync...')
  const wallets = await fetchWalletsNeedingSync(config, supabase)
  console.log(`   Found ${wallets.length} wallets to sync`)

  if (wallets.length === 0) {
    console.log('\n✅ No wallets need syncing!')
    return
  }

  if (config.dryRun) {
    console.log('\n🔍 DRY RUN - Would sync these wallets:')
    for (const wallet of wallets.slice(0, 10)) {
      console.log(
        `   ${wallet.wallet_address} (Ω=${wallet.omega_ratio?.toFixed(2) || 'N/A'}, last trade: ${wallet.last_trade_timestamp?.toISOString() || 'never'})`
      )
    }
    if (wallets.length > 10) {
      console.log(`   ... and ${wallets.length - 10} more`)
    }
    return
  }

  // Sync wallets
  console.log('\n' + '='.repeat(80))
  console.log('📈 SYNCING WALLETS')
  console.log('='.repeat(80))

  const startTime = Date.now()
  let completed = 0
  let failed = 0
  let totalNewTrades = 0

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]
    const result = await syncWalletIncremental(wallet, supabase, false)

    if (result.success) {
      completed++
      totalNewTrades += result.newTrades
    } else {
      failed++
    }

    // Show progress every 10 wallets
    if ((i + 1) % 10 === 0 || i === wallets.length - 1) {
      const progress = ((i + 1) / wallets.length) * 100
      const elapsed = (Date.now() - startTime) / 1000

      console.log(`\n[${i + 1}/${wallets.length}] Progress: ${progress.toFixed(1)}%`)
      console.log(`   ✅ Completed: ${completed} | ❌ Failed: ${failed}`)
      console.log(`   📈 New trades: ${totalNewTrades}`)
      console.log(`   ⏱️  Elapsed: ${elapsed.toFixed(1)}s`)
    }
  }

  const totalDuration = (Date.now() - startTime) / 1000

  console.log('\n\n' + '='.repeat(80))
  console.log('🎉 INCREMENTAL SYNC COMPLETE!')
  console.log('='.repeat(80))
  console.log('\nFinal Statistics:')
  console.log(`  Total wallets: ${wallets.length}`)
  console.log(`  ✅ Completed: ${completed}`)
  console.log(`  ❌ Failed: ${failed}`)
  console.log(`  📈 New trades synced: ${totalNewTrades}`)
  console.log(`  ⏱️  Total duration: ${totalDuration.toFixed(1)}s`)

  // Recalculate category omega for wallets with new trades
  if (config.recalculateOmega && totalNewTrades > 0) {
    console.log('\n📊 Recalculating category omega scores...')
    console.log(
      '   Run: npx tsx scripts/calculate-category-omega-sql.ts --only-synced --max-wallets ' +
        completed
    )
  }

  console.log('\n✅ Done!')
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
