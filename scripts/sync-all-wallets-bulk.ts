#!/usr/bin/env npx tsx
/**
 * Bulk Wallet Trade Sync
 *
 * Syncs ALL wallet trades from Goldsky to ClickHouse in bulk.
 * This is the CORRECT architecture for scaling to millions of trades.
 *
 * Features:
 * - Fetches all wallets from wallet_scores table (6,605+ wallets)
 * - Optionally expands to ALL wallets in markets
 * - Concurrent processing with configurable batch size
 * - Progress tracking with checkpoints
 * - Resume capability (picks up where it left off)
 * - Error handling with retry logic
 * - ETA calculation
 * - Sync metadata tracking
 *
 * Usage:
 *   # Sync all wallets in wallet_scores table
 *   npx tsx scripts/sync-all-wallets-bulk.ts
 *
 *   # Sync with custom batch size
 *   npx tsx scripts/sync-all-wallets-bulk.ts --batch-size 100
 *
 *   # Resume from checkpoint
 *   npx tsx scripts/sync-all-wallets-bulk.ts --resume
 *
 *   # Sync only wallets not yet synced
 *   npx tsx scripts/sync-all-wallets-bulk.ts --only-pending
 *
 *   # Dry run (show what would be synced)
 *   npx tsx scripts/sync-all-wallets-bulk.ts --dry-run
 *
 * Expected runtime: 24-48 hours for initial bulk sync
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs/promises'
import * as path from 'path'
import {
  createSupabaseClient,
  syncWalletTrades,
  SyncResult,
} from '@/lib/sync/wallet-trade-sync-utils'

// Configuration
const DEFAULT_BATCH_SIZE = 50 // Process 50 wallets concurrently
const CHECKPOINT_INTERVAL = 100 // Save checkpoint every 100 wallets
const MAX_RETRIES = 3 // Retry failed wallets up to 3 times
const RETRY_DELAY_MS = 5000 // Wait 5 seconds before retrying

interface BulkSyncConfig {
  batchSize: number
  onlyPending: boolean
  resume: boolean
  dryRun: boolean
  maxWallets?: number // For testing - limit total wallets
}

interface BulkSyncCheckpoint {
  totalWallets: number
  completedWallets: number
  failedWallets: number
  skippedWallets: number
  lastProcessedWallet: string
  lastCheckpointTime: string
  totalTradesSynced: number
  startTime: string
}

const CHECKPOINT_FILE = '.bulk-sync-checkpoint.json'

/**
 * Load checkpoint from disk
 */
async function loadCheckpoint(): Promise<BulkSyncCheckpoint | null> {
  try {
    const checkpointPath = path.join(process.cwd(), CHECKPOINT_FILE)
    const data = await fs.readFile(checkpointPath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    return null
  }
}

/**
 * Save checkpoint to disk
 */
async function saveCheckpoint(checkpoint: BulkSyncCheckpoint): Promise<void> {
  try {
    const checkpointPath = path.join(process.cwd(), CHECKPOINT_FILE)
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2))
  } catch (error) {
    console.error('Failed to save checkpoint:', error)
  }
}

/**
 * Fetch all wallets to sync
 */
async function fetchWalletsToSync(
  config: BulkSyncConfig,
  checkpoint: BulkSyncCheckpoint | null
): Promise<string[]> {
  const supabase = createSupabaseClient()

  if (config.onlyPending) {
    // Use the wallets_needing_sync view
    const { data, error } = await supabase
      .from('wallets_needing_sync')
      .select('wallet_address')
      .order('sync_priority', { ascending: false })
      .limit(config.maxWallets || 100000)

    if (error) {
      throw new Error(`Failed to fetch pending wallets: ${error.message}`)
    }

    return data?.map((w) => w.wallet_address) || []
  }

  // Fetch all wallets from discovered_wallets (new discovery system)
  // Use pagination to get all wallets (Supabase has a 1000 row limit per request)
  let allWallets: string[] = []
  let hasMore = true
  let offset = 0
  const BATCH_SIZE = 1000

  while (hasMore && (!config.maxWallets || allWallets.length < config.maxWallets)) {
    const { data, error } = await supabase
      .from('discovered_wallets')
      .select('wallet_address')
      .order('discovered_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      throw new Error(`Failed to fetch wallets: ${error.message}`)
    }

    if (!data || data.length === 0) {
      hasMore = false
      break
    }

    allWallets.push(...data.map((w) => w.wallet_address))
    offset += BATCH_SIZE

    if (data.length < BATCH_SIZE) {
      hasMore = false
    }
  }

  // Apply maxWallets limit if specified
  let wallets = config.maxWallets ? allWallets.slice(0, config.maxWallets) : allWallets

  // If resuming, filter out already processed wallets
  if (config.resume && checkpoint) {
    const lastIndex = wallets.indexOf(checkpoint.lastProcessedWallet)
    if (lastIndex >= 0) {
      wallets = wallets.slice(lastIndex + 1)
      console.log(`\n📍 Resuming from checkpoint: ${checkpoint.lastProcessedWallet}`)
      console.log(`   Already processed: ${checkpoint.completedWallets} wallets`)
      console.log(`   Remaining: ${wallets.length} wallets`)
    }
  }

  return wallets
}

/**
 * Process a batch of wallets concurrently
 */
async function processBatch(
  wallets: string[],
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<SyncResult[]> {
  const promises = wallets.map((wallet) =>
    syncWalletTrades(wallet, supabase, {
      verbose: false,
      skipIfRecent: false,
    })
  )

  return await Promise.all(promises)
}

/**
 * Calculate ETA
 */
function calculateETA(
  completed: number,
  total: number,
  startTime: Date
): { etaMs: number; etaFormatted: string } {
  if (completed === 0) {
    return { etaMs: 0, etaFormatted: 'calculating...' }
  }

  const elapsedMs = Date.now() - startTime.getTime()
  const msPerWallet = elapsedMs / completed
  const remainingWallets = total - completed
  const etaMs = remainingWallets * msPerWallet

  const hours = Math.floor(etaMs / (1000 * 60 * 60))
  const minutes = Math.floor((etaMs % (1000 * 60 * 60)) / (1000 * 60))

  return {
    etaMs,
    etaFormatted: `${hours}h ${minutes}m`,
  }
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Main bulk sync function
 */
async function bulkSyncWallets(config: BulkSyncConfig) {
  console.log('\n' + '='.repeat(80))
  console.log('🚀 BULK WALLET TRADE SYNC')
  console.log('='.repeat(80))
  console.log('\nConfiguration:')
  console.log(`  Batch size: ${config.batchSize}`)
  console.log(`  Only pending: ${config.onlyPending}`)
  console.log(`  Resume: ${config.resume}`)
  console.log(`  Dry run: ${config.dryRun}`)
  if (config.maxWallets) {
    console.log(`  Max wallets: ${config.maxWallets}`)
  }

  // Load checkpoint if resuming
  const checkpoint = config.resume ? await loadCheckpoint() : null

  // Fetch wallets to sync
  console.log('\n📊 Fetching wallets to sync...')
  const wallets = await fetchWalletsToSync(config, checkpoint)
  console.log(`   Found ${wallets.length} wallets to sync`)

  if (wallets.length === 0) {
    console.log('\n✅ No wallets to sync!')
    return
  }

  if (config.dryRun) {
    console.log('\n🔍 DRY RUN - Would sync these wallets:')
    console.log(wallets.slice(0, 10).join('\n'))
    if (wallets.length > 10) {
      console.log(`... and ${wallets.length - 10} more`)
    }
    return
  }

  // Initialize tracking
  const startTime = checkpoint?.startTime ? new Date(checkpoint.startTime) : new Date()
  const stats = {
    totalWallets: wallets.length,
    completedWallets: checkpoint?.completedWallets || 0,
    failedWallets: checkpoint?.failedWallets || 0,
    skippedWallets: checkpoint?.skippedWallets || 0,
    totalTradesSynced: checkpoint?.totalTradesSynced || 0,
    lastProcessedWallet: checkpoint?.lastProcessedWallet || '',
  }

  const failedWallets: Array<{ wallet: string; error: string; retries: number }> = []
  const supabase = createSupabaseClient()

  console.log('\n' + '='.repeat(80))
  console.log('📈 SYNC PROGRESS')
  console.log('='.repeat(80))

  // Process wallets in batches
  for (let i = 0; i < wallets.length; i += config.batchSize) {
    const batch = wallets.slice(i, Math.min(i + config.batchSize, wallets.length))
    const batchNumber = Math.floor(i / config.batchSize) + 1
    const totalBatches = Math.ceil(wallets.length / config.batchSize)

    console.log(
      `\n[Batch ${batchNumber}/${totalBatches}] Processing ${batch.length} wallets...`
    )

    // Process batch
    const results = await processBatch(batch, supabase)

    // Update stats
    for (const result of results) {
      if (result.success) {
        stats.completedWallets++
        stats.totalTradesSynced += result.trades_inserted
      } else {
        stats.failedWallets++
        failedWallets.push({
          wallet: result.wallet_address,
          error: result.error || 'Unknown error',
          retries: 0,
        })
      }
      stats.lastProcessedWallet = result.wallet_address
    }

    // Calculate progress
    const totalProcessed = stats.completedWallets + stats.failedWallets
    const progressPct = ((totalProcessed / stats.totalWallets) * 100).toFixed(1)
    const { etaFormatted } = calculateETA(totalProcessed, stats.totalWallets, startTime)
    const elapsed = formatDuration(Date.now() - startTime.getTime())

    // Show progress
    console.log(`\n📊 Progress: ${totalProcessed}/${stats.totalWallets} (${progressPct}%)`)
    console.log(`   ✅ Completed: ${stats.completedWallets}`)
    console.log(`   ❌ Failed: ${stats.failedWallets}`)
    console.log(`   📈 Total trades synced: ${stats.totalTradesSynced.toLocaleString()}`)
    console.log(`   ⏱️  Elapsed: ${elapsed}`)
    console.log(`   ⏳ ETA: ${etaFormatted}`)

    // Save checkpoint
    if (batchNumber % (CHECKPOINT_INTERVAL / config.batchSize) === 0 || i + config.batchSize >= wallets.length) {
      const checkpointData: BulkSyncCheckpoint = {
        totalWallets: stats.totalWallets,
        completedWallets: stats.completedWallets,
        failedWallets: stats.failedWallets,
        skippedWallets: stats.skippedWallets,
        lastProcessedWallet: stats.lastProcessedWallet,
        lastCheckpointTime: new Date().toISOString(),
        totalTradesSynced: stats.totalTradesSynced,
        startTime: startTime.toISOString(),
      }
      await saveCheckpoint(checkpointData)
      console.log(`   💾 Checkpoint saved`)
    }

    // Small delay between batches to avoid rate limiting
    if (i + config.batchSize < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // Retry failed wallets
  if (failedWallets.length > 0 && MAX_RETRIES > 0) {
    console.log(`\n\n🔄 Retrying ${failedWallets.length} failed wallets...`)

    for (const failed of failedWallets) {
      if (failed.retries >= MAX_RETRIES) {
        continue
      }

      console.log(`\n   Retry ${failed.retries + 1}/${MAX_RETRIES}: ${failed.wallet}`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))

      const result = await syncWalletTrades(failed.wallet, supabase, {
        verbose: false,
        skipIfRecent: false,
      })

      if (result.success) {
        stats.completedWallets++
        stats.failedWallets--
        stats.totalTradesSynced += result.trades_inserted
        console.log(`   ✅ Retry successful!`)
      } else {
        failed.retries++
        failed.error = result.error || 'Unknown error'
        console.log(`   ❌ Retry failed: ${failed.error}`)
      }
    }
  }

  // Final report
  const totalDuration = formatDuration(Date.now() - startTime.getTime())

  console.log('\n\n' + '='.repeat(80))
  console.log('🎉 BULK SYNC COMPLETE!')
  console.log('='.repeat(80))
  console.log('\nFinal Statistics:')
  console.log(`  Total wallets: ${stats.totalWallets}`)
  console.log(`  ✅ Completed: ${stats.completedWallets}`)
  console.log(`  ❌ Failed: ${stats.failedWallets}`)
  console.log(`  📈 Total trades synced: ${stats.totalTradesSynced.toLocaleString()}`)
  console.log(`  ⏱️  Total duration: ${totalDuration}`)
  console.log(
    `  🚀 Average: ${(stats.totalTradesSynced / stats.completedWallets).toFixed(0)} trades/wallet`
  )

  if (stats.failedWallets > 0) {
    console.log(`\n⚠️  ${stats.failedWallets} wallets failed to sync:`)
    const permanentlyFailed = failedWallets.filter((f) => f.retries >= MAX_RETRIES)
    for (const failed of permanentlyFailed.slice(0, 10)) {
      console.log(`   - ${failed.wallet}: ${failed.error}`)
    }
    if (permanentlyFailed.length > 10) {
      console.log(`   ... and ${permanentlyFailed.length - 10} more`)
    }
  }

  console.log('\n📊 Next steps:')
  console.log('   1. Calculate category omega: npx tsx scripts/calculate-category-omega-sql.ts')
  console.log('   2. Verify data: npx tsx scripts/verify-clickhouse-data.ts')
  console.log('   3. Set up incremental sync cron job')

  // Clean up checkpoint file
  try {
    await fs.unlink(path.join(process.cwd(), CHECKPOINT_FILE))
    console.log('\n💾 Checkpoint file cleaned up')
  } catch (error) {
    // Ignore - file might not exist
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): BulkSyncConfig {
  const args = process.argv.slice(2)
  const config: BulkSyncConfig = {
    batchSize: DEFAULT_BATCH_SIZE,
    onlyPending: false,
    resume: false,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--batch-size':
        config.batchSize = parseInt(args[++i]) || DEFAULT_BATCH_SIZE
        break
      case '--only-pending':
        config.onlyPending = true
        break
      case '--resume':
        config.resume = true
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--max-wallets':
        config.maxWallets = parseInt(args[++i])
        break
      case '--help':
        console.log(`
Bulk Wallet Trade Sync

Syncs all wallet trades from Goldsky to ClickHouse.

Usage:
  npx tsx scripts/sync-all-wallets-bulk.ts [options]

Options:
  --batch-size N      Process N wallets concurrently (default: ${DEFAULT_BATCH_SIZE})
  --only-pending      Only sync wallets that need syncing
  --resume            Resume from last checkpoint
  --dry-run           Show what would be synced without syncing
  --max-wallets N     Limit to first N wallets (for testing)
  --help              Show this help message

Examples:
  # Full sync of all wallets
  npx tsx scripts/sync-all-wallets-bulk.ts

  # Resume interrupted sync
  npx tsx scripts/sync-all-wallets-bulk.ts --resume

  # Sync only pending wallets
  npx tsx scripts/sync-all-wallets-bulk.ts --only-pending

  # Test with 100 wallets
  npx tsx scripts/sync-all-wallets-bulk.ts --max-wallets 100
        `)
        process.exit(0)
    }
  }

  return config
}

/**
 * Main entry point
 */
async function main() {
  try {
    const config = parseArgs()
    await bulkSyncWallets(config)
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  }
}

main()
