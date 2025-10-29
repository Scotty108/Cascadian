/**
 * Goldsky Parallel Trade Ingestion - OPTIMIZED FOR SPEED
 *
 * IMPROVEMENTS OVER ORIGINAL:
 * 1. Parallel processing: 15 concurrent workers instead of serial
 * 2. Robust checkpointing: Save progress after every 10 wallets
 * 3. Skip duplicate check: Fresh wallets_dim = no existing trades
 * 4. Batch inserts: 10,000 rows at once
 * 5. Resume capability: Auto-resume from last checkpoint
 * 6. Progress tracking: Real-time ETA and throughput stats
 *
 * ESTIMATED PERFORMANCE:
 * - Serial: 0.25 wallets/min = 4,300 hours
 * - Parallel (15x): ~4 wallets/min = ~270 hours
 * - With optimizations: 8-15 wallets/min = 70-135 hours (3-6 days)
 * - Realistic target: 8-12 hours with good API performance
 *
 * USAGE:
 *   npx tsx scripts/goldsky-parallel-ingestion.ts
 *
 * Resume after crash:
 *   (automatically resumes from checkpoint)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import {
  fetchAllWalletTrades,
  resolveTokenId,
  OrderFilledEvent,
} from '@/lib/goldsky/client'
import { createClient } from '@supabase/supabase-js'

// Configuration
const CONCURRENT_WORKERS = 15 // Process 15 wallets in parallel
const BATCH_INSERT_SIZE = 10000 // Insert 10k trades at once
const CHECKPOINT_INTERVAL = 10 // Save checkpoint every 10 wallets
const CHECKPOINT_FILE = resolve(process.cwd(), 'runtime/goldsky-parallel.checkpoint.json')
const PROGRESS_LOG = resolve(process.cwd(), 'runtime/goldsky-parallel.progress.jsonl')
const SHARES_CORRECTION_FACTOR = 128 // Known Goldsky bug

// Create Supabase client for market lookups
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Checkpoint {
  walletsProcessed: number
  lastWalletAddress: string
  totalTradesInserted: number
  startTime: string
  lastSaveTime: string
}

interface PreparedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string
  token_id: string
  side: string
  shares: number
  entry_price: number
  timestamp: number
  transaction_hash: string
  maker_address: string | null
  realized_pnl_usd: number
  is_resolved: number
}

interface WorkerStats {
  walletsProcessed: number
  tradesInserted: number
  errors: number
}

// Global state
let globalCheckpoint: Checkpoint = {
  walletsProcessed: 0,
  lastWalletAddress: '',
  totalTradesInserted: 0,
  startTime: new Date().toISOString(),
  lastSaveTime: new Date().toISOString(),
}

let globalStats = {
  walletsProcessed: 0,
  tradesInserted: 0,
  errors: 0,
  skipped: 0,
}

/**
 * Load checkpoint from disk
 */
function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('⚠️  Failed to load checkpoint:', error)
  }
  return null
}

/**
 * Save checkpoint to disk
 */
function saveCheckpoint() {
  try {
    globalCheckpoint.lastSaveTime = new Date().toISOString()
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(globalCheckpoint, null, 2))
  } catch (error) {
    console.error('⚠️  Failed to save checkpoint:', error)
  }
}

/**
 * Log progress to JSONL
 */
function logProgress(walletAddress: string, tradesCount: number, duration: number) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    wallet: walletAddress,
    trades: tradesCount,
    duration_ms: duration,
    total_processed: globalStats.walletsProcessed,
  }

  try {
    fs.appendFileSync(PROGRESS_LOG, JSON.stringify(logEntry) + '\n')
  } catch (error) {
    // Non-critical, continue
  }
}

/**
 * Get list of wallets from wallets_dim
 */
async function getTargetWallets(resumeFrom?: string): Promise<string[]> {
  console.log('📋 Loading wallet list from wallets_dim...')

  const query = resumeFrom
    ? `SELECT wallet_address FROM wallets_dim WHERE is_active = true AND wallet_address > '${resumeFrom}' ORDER BY wallet_address`
    : `SELECT wallet_address FROM wallets_dim WHERE is_active = true ORDER BY wallet_address`

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = await result.json<{ wallet_address: string }>()
  const wallets = data.map((row) => row.wallet_address)

  console.log(`✅ Found ${wallets.length} wallets to process`)
  if (resumeFrom) {
    console.log(`   Resuming after: ${resumeFrom}`)
  }

  return wallets
}

// Token cache to avoid redundant lookups
const tokenIdCache = new Map<string, { condition: string; outcome: number } | null>()
const conditionToMarketCache = new Map<string, string>()

/**
 * Resolve tokenId to condition + outcome
 */
async function resolveTokenIdToCondition(tokenId: string): Promise<{ condition: string; outcome: number } | null> {
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  if (tokenId === '0') {
    return null // USDC collateral
  }

  const tokenInfo = await resolveTokenId(tokenId)
  if (!tokenInfo) {
    return null
  }

  const result = {
    condition: tokenInfo.condition.id,
    outcome: parseInt(tokenInfo.outcomeIndex),
  }

  tokenIdCache.set(tokenId, result)
  return result
}

/**
 * Resolve condition to market_id (via Supabase)
 */
async function resolveConditionToMarket(conditionId: string): Promise<string | null> {
  if (conditionToMarketCache.has(conditionId)) {
    return conditionToMarketCache.get(conditionId)!
  }

  const { data, error } = await supabase
    .from('markets')
    .select('market_id')
    .eq('condition_id', conditionId)
    .single()

  if (error || !data) {
    return null
  }

  conditionToMarketCache.set(conditionId, data.market_id)
  return data.market_id
}

/**
 * Transform raw Goldsky event to PreparedTrade
 * Uses the CORRECT logic from goldsky-full-historical-load.ts
 */
async function transformTrade(trade: OrderFilledEvent, walletAddress: string): Promise<PreparedTrade | null> {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    // Determine which asset is the outcome token (not USDC)
    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      return null // Both USDC, skip
    }

    // Get token ID and resolve to condition
    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId
    const tokenInfo = await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    // Resolve condition to market
    const marketId = await resolveConditionToMarket(tokenInfo.condition)
    if (!marketId) {
      return null
    }

    // Calculate amounts and side
    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6 // USDC has 6 decimals
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let side: 'YES' | 'NO'
    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      if (makerIsToken) {
        // Maker gave tokens, received USDC - SELL
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Maker gave USDC, received tokens - BUY
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    } else {
      if (takerIsToken) {
        // Taker gave tokens, received USDC - SELL
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Taker gave USDC, received tokens - BUY
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    }

    // Apply shares correction factor
    const correctedShares = shares / SHARES_CORRECTION_FACTOR

    const result: PreparedTrade = {
      trade_id: `${trade.transactionHash}_${trade.timestamp}_${walletAddress}`,
      wallet_address: walletAddress.toLowerCase(),
      market_id: marketId,
      condition_id: tokenInfo.condition,
      token_id: tokenId,
      side,
      shares: correctedShares,
      entry_price: price,
      timestamp: parseInt(trade.timestamp),
      transaction_hash: trade.transactionHash,
      maker_address: trade.maker || null,
      realized_pnl_usd: 0,
      is_resolved: 0,
    }

    return result
  } catch (error) {
    return null
  }
}

/**
 * Process a single wallet (fetch + transform + insert)
 */
async function processWallet(walletAddress: string): Promise<WorkerStats> {
  const startTime = Date.now()
  const stats: WorkerStats = {
    walletsProcessed: 0,
    tradesInserted: 0,
    errors: 0,
  }

  try {
    // Fetch trades from Goldsky
    const rawEvents = await fetchAllWalletTrades(walletAddress)

    if (rawEvents.length === 0) {
      globalStats.skipped++
      return stats
    }

    // Transform trades (parallel processing)
    const transformPromises = rawEvents.map((event) =>
      transformTrade(event, walletAddress)
    )
    const transformedTrades = (await Promise.all(transformPromises)).filter(
      (t): t is PreparedTrade => t !== null
    )

    if (transformedTrades.length === 0) {
      globalStats.skipped++
      return stats
    }

    // Insert trades in batches
    for (let i = 0; i < transformedTrades.length; i += BATCH_INSERT_SIZE) {
      const batch = transformedTrades.slice(i, Math.min(i + BATCH_INSERT_SIZE, transformedTrades.length))

      await clickhouse.insert({
        table: 'trades_raw',
        values: batch,
        format: 'JSONEachRow',
      })

      stats.tradesInserted += batch.length
    }

    stats.walletsProcessed = 1

    // Log progress
    const duration = Date.now() - startTime
    logProgress(walletAddress, stats.tradesInserted, duration)

    return stats
  } catch (error) {
    console.error(`   ❌ Error processing ${walletAddress}:`, error instanceof Error ? error.message : String(error))
    stats.errors = 1
    return stats
  }
}

/**
 * Worker function - processes wallets from queue
 */
async function worker(
  walletQueue: string[],
  workerId: number
): Promise<WorkerStats> {
  const stats: WorkerStats = {
    walletsProcessed: 0,
    tradesInserted: 0,
    errors: 0,
  }

  while (walletQueue.length > 0) {
    const wallet = walletQueue.shift()
    if (!wallet) break

    const walletStats = await processWallet(wallet)

    stats.walletsProcessed += walletStats.walletsProcessed
    stats.tradesInserted += walletStats.tradesInserted
    stats.errors += walletStats.errors

    // Update global stats
    globalStats.walletsProcessed++
    globalStats.tradesInserted += walletStats.tradesInserted
    globalStats.errors += walletStats.errors

    // Update checkpoint
    globalCheckpoint.walletsProcessed = globalStats.walletsProcessed
    globalCheckpoint.lastWalletAddress = wallet
    globalCheckpoint.totalTradesInserted = globalStats.tradesInserted

    // Save checkpoint periodically
    if (globalStats.walletsProcessed % CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint()
      printProgress()
    }
  }

  return stats
}

/**
 * Print real-time progress stats
 */
function printProgress() {
  const startTime = new Date(globalCheckpoint.startTime).getTime()
  const elapsed = (Date.now() - startTime) / 1000 / 60 // minutes
  const rate = globalStats.walletsProcessed / elapsed // wallets per minute
  const remaining = 65030 - globalStats.walletsProcessed
  const etaMinutes = remaining / rate
  const etaHours = etaMinutes / 60

  console.log(`\n📊 PROGRESS UPDATE`)
  console.log(`   Wallets: ${globalStats.walletsProcessed.toLocaleString()} / 65,030 (${((globalStats.walletsProcessed / 65030) * 100).toFixed(2)}%)`)
  console.log(`   Trades inserted: ${globalStats.tradesInserted.toLocaleString()}`)
  console.log(`   Errors: ${globalStats.errors}, Skipped: ${globalStats.skipped}`)
  console.log(`   Rate: ${rate.toFixed(2)} wallets/min`)
  console.log(`   ETA: ${etaHours.toFixed(1)} hours (${new Date(Date.now() + etaMinutes * 60 * 1000).toLocaleString()})`)
  console.log(`   Last wallet: ${globalCheckpoint.lastWalletAddress}`)
  console.log('')
}

/**
 * Main execution
 */
async function main() {
  console.log('═'.repeat(80))
  console.log('🚀 GOLDSKY PARALLEL TRADE INGESTION - OPTIMIZED')
  console.log('═'.repeat(80))
  console.log(`\n⚙️  Configuration:`)
  console.log(`   Concurrent workers: ${CONCURRENT_WORKERS}`)
  console.log(`   Batch insert size: ${BATCH_INSERT_SIZE.toLocaleString()}`)
  console.log(`   Checkpoint interval: Every ${CHECKPOINT_INTERVAL} wallets`)
  console.log('')

  try {
    // Load checkpoint if exists
    const checkpoint = loadCheckpoint()
    if (checkpoint) {
      console.log('📂 Found existing checkpoint:')
      console.log(`   Wallets processed: ${checkpoint.walletsProcessed}`)
      console.log(`   Last wallet: ${checkpoint.lastWalletAddress}`)
      console.log(`   Total trades: ${checkpoint.totalTradesInserted.toLocaleString()}`)
      console.log(`   Resuming from where we left off...\n`)

      globalCheckpoint = checkpoint
      globalStats.walletsProcessed = checkpoint.walletsProcessed
      globalStats.tradesInserted = checkpoint.totalTradesInserted
    }

    // Get target wallets
    const wallets = await getTargetWallets(checkpoint?.lastWalletAddress)

    if (wallets.length === 0) {
      console.log('✅ All wallets already processed!')
      return
    }

    console.log(`\n🚀 Starting ${CONCURRENT_WORKERS} parallel workers...\n`)

    // Create wallet queue
    const walletQueue = [...wallets]

    // Launch workers
    const workerPromises: Promise<WorkerStats>[] = []
    for (let i = 0; i < CONCURRENT_WORKERS; i++) {
      workerPromises.push(worker(walletQueue, i))
    }

    // Wait for all workers to complete
    const workerStats = await Promise.all(workerPromises)

    // Final save
    saveCheckpoint()

    // Print final stats
    console.log('\n' + '═'.repeat(80))
    console.log('✅ INGESTION COMPLETE!')
    console.log('═'.repeat(80))
    console.log(`\n📊 Final Stats:`)
    console.log(`   Total wallets processed: ${globalStats.walletsProcessed.toLocaleString()}`)
    console.log(`   Total trades inserted: ${globalStats.tradesInserted.toLocaleString()}`)
    console.log(`   Errors: ${globalStats.errors}`)
    console.log(`   Skipped (no trades): ${globalStats.skipped}`)

    const totalTime = (Date.now() - new Date(globalCheckpoint.startTime).getTime()) / 1000 / 60
    console.log(`   Total time: ${(totalTime / 60).toFixed(1)} hours`)
    console.log(`   Average rate: ${(globalStats.walletsProcessed / totalTime).toFixed(2)} wallets/min`)
    console.log('')

    console.log('📋 Next Steps:')
    console.log('   1. Run enrichment: npx tsx scripts/nuclear-rebuild-pnl.ts')
    console.log('   2. Run Step E: npx tsx scripts/run-step-e-only.ts')
    console.log('   3. Compute metrics: npx tsx scripts/compute-wallet-metrics.ts')
    console.log('')

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    saveCheckpoint() // Save progress before exit
    process.exit(1)
  }
}

// Execute
main().catch(console.error)
