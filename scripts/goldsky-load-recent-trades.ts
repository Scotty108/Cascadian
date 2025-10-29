#!/usr/bin/env tsx
/**
 * Goldsky Recent Trades Load (OPTIMIZED)
 *
 * PURPOSE:
 * Fast initial load of recent trade data for 65k wallets.
 * Limits per-wallet trade fetch to prevent bottlenecks from mega-traders.
 *
 * OPTIMIZATIONS:
 * - Max 5,000 trades per wallet (prevents 38k+ trade wallets from stalling)
 * - Only trades from last 365 days (most relevant for current metrics)
 * - Same deduplication and checkpoint logic as full load
 * - Can backfill historical data later with separate script
 *
 * USAGE:
 * Normal mode (from wallets_dim):
 *   npx tsx scripts/goldsky-load-recent-trades.ts
 *
 * From file:
 *   npx tsx scripts/goldsky-load-recent-trades.ts \
 *     --wallets-file=runtime/wallets_10k_plus_addresses.txt
 *
 * EXPECTED PERFORMANCE:
 * - 65k wallets with 5k trade cap should complete in 2-6 hours
 * - vs weeks for unlimited fetch
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import {
  fetchWalletTrades,
  resolveTokenId,
  OrderFilledEvent,
} from '@/lib/goldsky/client'
import { CachedTokenResolver } from '@/lib/goldsky/batch-resolver'
import { createClient } from '@supabase/supabase-js'

// Parse command-line arguments
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const WALLETS_FILE = getArg('wallets-file') || null
const CHECKPOINT_FILE = getArg('checkpoint') || resolve(process.cwd(), 'runtime/goldsky-recent.checkpoint.json')
const PROGRESS_LOG = CHECKPOINT_FILE.replace('.checkpoint.json', '.progress.jsonl')
const BATCH_INSERT_SIZE = 5000
const RATE_LIMIT_DELAY_MS = 100 // 100ms between wallets

// OPTIMIZATION PARAMETERS
const MAX_TRADES_PER_WALLET = 5000 // Cap to prevent mega-trader bottleneck
const DAYS_LOOKBACK = 365 // Only last year of trades
const MIN_TIMESTAMP = Math.floor(Date.now() / 1000) - (DAYS_LOOKBACK * 24 * 60 * 60)

// Known inflation bug in Goldsky data - shares are 128x too high
const SHARES_CORRECTION_FACTOR = 128

// Error handling & backoff configuration
const MAX_CONSECUTIVE_ERRORS = 5 // Pause worker after 5 errors in a row
const BACKOFF_BASE_MS = 2000 // Start with 2 second backoff
const MAX_BACKOFF_MS = 60000 // Max 1 minute backoff
let consecutiveErrors = 0
let currentBackoffMs = BACKOFF_BASE_MS

// Exponential backoff with jitter
async function backoffAndRetry(attemptNumber: number = 0): Promise<void> {
  if (attemptNumber === 0) return // First attempt, no backoff

  const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, attemptNumber - 1), MAX_BACKOFF_MS)
  const jitter = Math.random() * 1000 // Add 0-1s jitter
  const totalWait = backoff + jitter

  console.log(`  ⏸️  Backing off for ${(totalWait / 1000).toFixed(1)}s before retry (attempt ${attemptNumber})...`)
  await new Promise(resolve => setTimeout(resolve, totalWait))
}

// Create Supabase client for market lookups
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

interface PreparedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string
  timestamp: number // Unix timestamp in seconds
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
  realized_pnl_usd: number
  is_resolved: number
}

interface PreparedInsertBatch {
  trades: PreparedTrade[]
  new_count: number
  duplicate_count: number
}

interface Checkpoint {
  wallet_index: number
  wallet_address: string
  total_fetched: number
  total_inserted: number
  total_duplicates: number
  total_capped: number // Wallets that hit the 5k trade limit
  timestamp: string
}

interface ProgressEntry {
  wallet_address: string
  wallet_index: number
  fetched_count: number
  inserted_count: number
  duplicates_skipped: number
  hit_cap: boolean
  timestamp: string
}

// Cache for condition -> market_id mapping
const conditionToMarketCache = new Map<string, string>()

// Cache for token ID -> condition mapping
// Load from persistent file if exists
const CACHE_FILE = resolve(process.cwd(), 'runtime/token-id-cache.json')
const tokenIdCache = new Map<string, { condition: string; outcome: number }>()

// Load cache from file
function loadTokenCache(): void {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      for (const [tokenId, mapping] of Object.entries(cacheData)) {
        tokenIdCache.set(tokenId, mapping as { condition: string; outcome: number })
      }
      console.log(`📦 Loaded ${tokenIdCache.size} token mappings from cache`)
    } catch (error) {
      console.warn('⚠️  Failed to load token cache:', error)
    }
  }
}

// Save cache to file periodically
let cacheUpdateCounter = 0
function saveTokenCache(): void {
  try {
    const cacheObj = Object.fromEntries(tokenIdCache.entries())
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2))
  } catch (error) {
    console.warn('⚠️  Failed to save token cache:', error)
  }
}

/**
 * Batch resolve condition IDs to market IDs using Supabase RPC
 * PERFORMANCE: Replaces N queries with 1-3 batched calls
 */
async function batchResolveConditionsToMarkets(conditionIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  if (conditionIds.length === 0) return map

  // Chunk to stay under Supabase payload limits (400 per chunk)
  const CHUNK_SIZE = 400
  const chunks: string[][] = []
  for (let i = 0; i < conditionIds.length; i += CHUNK_SIZE) {
    chunks.push(conditionIds.slice(i, i + CHUNK_SIZE))
  }

  // Resolve each chunk with retry logic
  for (const chunk of chunks) {
    let attempt = 0
    const maxAttempts = 3

    while (attempt < maxAttempts) {
      try {
        await backoffAndRetry(attempt)

        const { data, error } = await supabase.rpc('resolve_condition_to_market_batch', {
          condition_ids: chunk
        })

        if (error) {
          // Check for rate limit / overload errors
          if (error.message?.includes('522') || error.message?.includes('503') || error.message?.includes('429')) {
            console.error(`  ⚠️  Rate limit detected (${error.message}), backing off...`)
            consecutiveErrors++
            attempt++

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error(`  🛑 Too many consecutive errors (${consecutiveErrors}), pausing 30s...`)
              await new Promise(resolve => setTimeout(resolve, 30000))
              consecutiveErrors = 0
            }
            continue
          }

          console.error(`  ⚠️  Batch resolve error:`, error.message)
          attempt++
          continue
        }

        if (data) {
          for (const row of data) {
            map.set(row.condition_id, row.market_id)
            conditionToMarketCache.set(row.condition_id, row.market_id)
          }
        }

        consecutiveErrors = 0 // Reset on success
        break // Success, move to next chunk
      } catch (error: any) {
        console.error(`  ⚠️  Batch resolve exception:`, error.message)
        consecutiveErrors++
        attempt++

        if (attempt >= maxAttempts) {
          console.error(`  ❌ Max retries reached for chunk, skipping...`)
        }
      }
    }
  }

  return map
}

/**
 * Resolve condition ID to market ID using Supabase markets table (fallback for single queries)
 */
async function resolveConditionToMarket(conditionId: string): Promise<string | null> {
  // Check cache
  if (conditionToMarketCache.has(conditionId)) {
    return conditionToMarketCache.get(conditionId)!
  }

  // Query Supabase for market with this condition
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
 * Resolve token ID to condition and outcome index
 * Uses cache first, falls back to Goldsky API
 */
async function resolveTokenIdToCondition(
  tokenId: string
): Promise<{ condition: string; outcome: number } | null> {
  // Check cache first
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  // Token ID "0" is USDC collateral, not an outcome token
  if (tokenId === '0') {
    return null
  }

  // Query Goldsky positions subgraph with retry logic
  const tokenInfo = await resolveTokenId(tokenId)

  if (!tokenInfo) {
    return null
  }

  const result = {
    condition: tokenInfo.condition.id,
    outcome: parseInt(tokenInfo.outcomeIndex),
  }

  // Add to cache
  tokenIdCache.set(tokenId, result)

  // Save cache every 100 new entries
  cacheUpdateCounter++
  if (cacheUpdateCounter % 100 === 0) {
    saveTokenCache()
  }

  return result
}

/**
 * Transform OrderFilledEvent to PreparedTrade format
 */
async function transformTrade(
  trade: OrderFilledEvent,
  walletAddress: string,
  tokenResolver?: CachedTokenResolver,
  conditionToMarketMap?: Map<string, string>
): Promise<PreparedTrade | null> {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    // Determine which asset is the outcome token (not USDC)
    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      // Both are USDC? Skip (shouldn't happen)
      return null
    }

    // Get token ID and resolve to condition
    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId

    // Use cached resolver if provided (5,300x faster!), otherwise fall back to sequential
    const tokenInfo = tokenResolver
      ? await tokenResolver.resolveToken(tokenId)
      : await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    // Resolve condition to market (use batched map if available, otherwise fall back)
    const conditionId = 'conditionId' in tokenInfo ? tokenInfo.conditionId : tokenInfo.condition
    const marketId = conditionToMarketMap
      ? (conditionToMarketMap.get(conditionId) || '')
      : await resolveConditionToMarket(conditionId)

    // Calculate amounts and side
    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6 // USDC has 6 decimals
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let side: 'YES' | 'NO'
    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      // Wallet is maker
      if (makerIsToken) {
        // Maker gave tokens, received USDC - this is a SELL
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        // Selling means exiting a position
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Maker gave USDC, received tokens - this is a BUY
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    } else {
      // Wallet is taker
      if (takerIsToken) {
        // Taker gave tokens, received USDC - this is a SELL
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Taker gave USDC, received tokens - this is a BUY
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    }

    // Apply shares correction factor for Goldsky inflation bug
    const correctedShares = shares / SHARES_CORRECTION_FACTOR

    return {
      trade_id: trade.id,
      wallet_address: walletAddress.toLowerCase(),
      market_id: marketId || '', // Empty string if no market found
      condition_id: conditionId,
      timestamp: parseInt(trade.timestamp),
      side,
      entry_price: price,
      shares: correctedShares,
      usd_value: price * correctedShares, // Recalculate with corrected shares
      transaction_hash: trade.transactionHash,
      is_closed: false,
      realized_pnl_usd: 0, // Will be calculated later in enrichment
      is_resolved: 0, // Will be set later in enrichment
    }
  } catch (error) {
    console.error(`  ❌ Error transforming trade ${trade.id}:`, error)
    return null
  }
}

/**
 * Fetch recent trades for a single wallet (OPTIMIZED)
 * - Fetches in batches with pagination
 * - Stops at MAX_TRADES_PER_WALLET cap
 * - Filters out trades older than MIN_TIMESTAMP
 */
async function fetchRecentTradesForWallet(wallet: string): Promise<{
  trades: OrderFilledEvent[]
  hitCap: boolean
}> {
  try {
    const allTrades: OrderFilledEvent[] = []
    const batchSize = 1000
    let skip = 0
    let hitCap = false

    while (allTrades.length < MAX_TRADES_PER_WALLET) {
      const remainingSlots = MAX_TRADES_PER_WALLET - allTrades.length
      const fetchSize = Math.min(batchSize, remainingSlots)

      const trades = await fetchWalletTrades(wallet, fetchSize, skip)

      if (trades.length === 0) {
        break // No more trades available
      }

      // Filter trades by timestamp (keep only recent ones)
      const recentTrades = trades.filter(t => parseInt(t.timestamp) >= MIN_TIMESTAMP)

      allTrades.push(...recentTrades)

      // If we got fewer trades than requested, we've reached the end
      if (trades.length < fetchSize) {
        break
      }

      // If last trade in batch is too old, stop fetching
      const lastTradeTimestamp = parseInt(trades[trades.length - 1].timestamp)
      if (lastTradeTimestamp < MIN_TIMESTAMP) {
        break
      }

      // Check if we hit the cap
      if (allTrades.length >= MAX_TRADES_PER_WALLET) {
        hitCap = true
        break
      }

      skip += batchSize
    }

    return {
      trades: allTrades.slice(0, MAX_TRADES_PER_WALLET), // Enforce cap
      hitCap: hitCap || allTrades.length === MAX_TRADES_PER_WALLET
    }
  } catch (error) {
    console.error(`  ❌ Failed to fetch trades for ${wallet}:`, error)
    throw error
  }
}

/**
 * De-duplicate trades against existing trades_raw data
 */
async function dedupeAndPrepareInserts(
  rawTrades: PreparedTrade[],
  walletAddress: string
): Promise<PreparedInsertBatch> {
  if (rawTrades.length === 0) {
    return {
      trades: [],
      new_count: 0,
      duplicate_count: 0,
    }
  }

  try {
    // Query ClickHouse for existing trade identifiers for this wallet
    const existingQuery = `
      SELECT DISTINCT transaction_hash, timestamp
      FROM trades_raw
      WHERE wallet_address = '${walletAddress.toLowerCase()}'
    `

    const existingResult = await clickhouse.query({
      query: existingQuery,
      format: 'JSONEachRow',
    })

    const existingData = await existingResult.json()
    const existingKeys = new Set<string>()

    for (const row of existingData as any[]) {
      existingKeys.add(`${row.transaction_hash}:${row.timestamp}`)
    }

    // Filter out duplicates
    const newTrades = rawTrades.filter((trade) => {
      const key = `${trade.transaction_hash}:${trade.timestamp}`
      return !existingKeys.has(key)
    })

    return {
      trades: newTrades,
      new_count: newTrades.length,
      duplicate_count: rawTrades.length - newTrades.length,
    }
  } catch (error) {
    console.error(`  ❌ Error during deduplication:`, error)
    throw error
  }
}

/**
 * Insert new trades into ClickHouse trades_raw
 */
async function insertNewTradesToClickHouse(batch: PreparedInsertBatch): Promise<void> {
  if (batch.new_count === 0) {
    return
  }

  try {
    // Insert in batches of BATCH_INSERT_SIZE
    for (let i = 0; i < batch.trades.length; i += BATCH_INSERT_SIZE) {
      const batchSlice = batch.trades.slice(i, i + BATCH_INSERT_SIZE)

      await clickhouse.insert({
        table: 'trades_raw',
        values: batchSlice,
        format: 'JSONEachRow',
      })

      console.log(
        `  📥 Inserted batch ${Math.floor(i / BATCH_INSERT_SIZE) + 1}/${Math.ceil(batch.trades.length / BATCH_INSERT_SIZE)} (${batchSlice.length} trades)`
      )
    }
  } catch (error) {
    console.error(`  ❌ Failed to insert trades:`, error)
    throw error
  }
}

/**
 * Save checkpoint to allow resume
 */
async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

/**
 * Load checkpoint if exists
 */
function loadCheckpoint(): Checkpoint | null {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
  }
  return null
}

/**
 * Log progress entry (append to JSONL)
 */
function logProgress(progress: ProgressEntry): void {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  const line = JSON.stringify(progress) + '\n'
  fs.appendFileSync(PROGRESS_LOG, line)
}

/**
 * Load list of target wallets from ClickHouse
 */
async function getTargetWallets(): Promise<string[]> {
  try {
    console.log('📋 Loading target wallet list from ClickHouse wallets_dim...')

    const query = `
      SELECT DISTINCT wallet_address
      FROM wallets_dim
      WHERE is_active = true
      ORDER BY wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const data = (await result.json()) as any[]
    const wallets = data.map((row) => row.wallet_address)

    console.log(`✅ Found ${wallets.length} wallets in wallets_dim`)
    return wallets
  } catch (error) {
    console.error('❌ Failed to load wallets from ClickHouse:', error)
    throw error
  }
}

/**
 * Load wallets from text file (one address per line)
 */
function loadWalletsFromFile(filePath: string): string[] {
  try {
    console.log(`📋 Loading wallet list from file: ${filePath}`)

    if (!fs.existsSync(filePath)) {
      throw new Error(`Wallets file not found: ${filePath}`)
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const wallets = content
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line.startsWith('0x'))

    console.log(`✅ Loaded ${wallets.length} wallets from file`)
    return wallets
  } catch (error) {
    console.error('❌ Failed to load wallets from file:', error)
    throw error
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Main execution function
 */
export async function main() {
  console.log('🌊 Goldsky Recent Trades Load (OPTIMIZED)\n')
  console.log('⚡ OPTIMIZATION SETTINGS:')
  console.log(`   Max trades per wallet: ${MAX_TRADES_PER_WALLET.toLocaleString()}`)
  console.log(`   Lookback period: ${DAYS_LOOKBACK} days`)
  console.log(`   Min timestamp: ${new Date(MIN_TIMESTAMP * 1000).toISOString()}`)
  console.log('')

  // Load token ID cache
  loadTokenCache()

  // Load checkpoint if exists
  const checkpoint = loadCheckpoint()
  if (checkpoint) {
    console.log(`📌 Resuming from checkpoint:`)
    console.log(`   Last wallet: ${checkpoint.wallet_address}`)
    console.log(`   Wallet index: ${checkpoint.wallet_index}`)
    console.log(`   Total fetched: ${checkpoint.total_fetched}`)
    console.log(`   Total inserted: ${checkpoint.total_inserted}`)
    console.log(`   Wallets capped: ${checkpoint.total_capped}`)
    console.log(`   Total duplicates: ${checkpoint.total_duplicates}\n`)
  }

  // Get target wallets
  let wallets: string[]
  if (WALLETS_FILE) {
    wallets = loadWalletsFromFile(WALLETS_FILE)
  } else {
    wallets = await getTargetWallets()
  }
  console.log(`📋 Target wallets: ${wallets.length}`)

  const startIndex = checkpoint ? checkpoint.wallet_index + 1 : 0
  let totalFetched = checkpoint ? checkpoint.total_fetched : 0
  let totalInserted = checkpoint ? checkpoint.total_inserted : 0
  let totalDuplicates = checkpoint ? checkpoint.total_duplicates : 0
  let totalCapped = checkpoint ? checkpoint.total_capped : 0

  console.log(`\n🔄 Processing wallets ${startIndex} to ${wallets.length - 1}`)
  console.log(`⏱️  Rate limit: ${RATE_LIMIT_DELAY_MS}ms delay between wallets\n`)

  const startTime = Date.now()

  // Process each wallet
  for (let i = startIndex; i < wallets.length; i++) {
    const wallet = wallets[i]
    const progress = ((i + 1) / wallets.length) * 100

    console.log(`\n[${i + 1}/${wallets.length}] ${progress.toFixed(1)}% - Processing wallet: ${wallet}`)

    try {
      // Fetch recent trades from Goldsky
      console.log(`  📡 Fetching recent trades (max ${MAX_TRADES_PER_WALLET})...`)
      const { trades: rawEvents, hitCap } = await fetchRecentTradesForWallet(wallet)

      const capIndicator = hitCap ? ' 🔴 HIT CAP' : ''
      console.log(`  ✅ Fetched ${rawEvents.length} raw trade events${capIndicator}`)

      if (hitCap) {
        totalCapped++
      }

      if (rawEvents.length === 0) {
        console.log('  ⏭️  No trades found, skipping')

        // Log progress
        const progressEntry: ProgressEntry = {
          wallet_address: wallet,
          wallet_index: i,
          fetched_count: 0,
          inserted_count: 0,
          duplicates_skipped: 0,
          hit_cap: false,
          timestamp: new Date().toISOString(),
        }
        logProgress(progressEntry)

        // Save checkpoint
        const newCheckpoint: Checkpoint = {
          wallet_index: i,
          wallet_address: wallet,
          total_fetched: totalFetched,
          total_inserted: totalInserted,
          total_duplicates: totalDuplicates,
          total_capped: totalCapped,
          timestamp: new Date().toISOString(),
        }
        await saveCheckpoint(newCheckpoint)

        continue
      }

      // BATCH OPTIMIZATION: Extract all unique token IDs and pre-resolve them
      console.log('  🔄 Extracting token IDs for batch resolution...')
      const tokenIds = new Set<string>()
      for (const event of rawEvents) {
        const makerIsToken = event.makerAssetId !== '0'
        const takerIsToken = event.takerAssetId !== '0'

        if (makerIsToken) tokenIds.add(event.makerAssetId)
        if (takerIsToken) tokenIds.add(event.takerAssetId)
      }

      const tokenResolver = new CachedTokenResolver(25000)
      const uniqueTokens = Array.from(tokenIds)
      console.log(`  🚀 Batch resolving ${uniqueTokens.length} unique tokens...`)

      const batchStart = Date.now()
      await tokenResolver.warmCache(uniqueTokens)
      const batchDuration = Date.now() - batchStart
      console.log(`  ✅ Batch resolved in ${batchDuration}ms (${(uniqueTokens.length / (batchDuration / 1000)).toFixed(0)} tokens/sec)`)

      // BATCH OPTIMIZATION 2: Pre-resolve all condition→market mappings in one call
      console.log('  🔄 Extracting unique conditions for batch market resolution...')
      const conditionIds = new Set<string>()
      for (const event of rawEvents) {
        const makerIsToken = event.makerAssetId !== '0'
        const takerIsToken = event.takerAssetId !== '0'
        const tokenId = makerIsToken ? event.makerAssetId : event.takerAssetId

        // Get condition from cached token resolver
        const tokenInfo = await tokenResolver.resolveToken(tokenId)
        if (tokenInfo?.conditionId) {
          conditionIds.add(tokenInfo.conditionId)
        }
      }

      const uniqueConditions = Array.from(conditionIds)
      console.log(`  🚀 Batch resolving ${uniqueConditions.length} unique conditions to markets...`)

      const conditionStart = Date.now()
      const conditionToMarketMap = await batchResolveConditionsToMarkets(uniqueConditions)
      const conditionDuration = Date.now() - conditionStart
      console.log(`  ✅ Batch resolved in ${conditionDuration}ms (${(uniqueConditions.length / (conditionDuration / 1000)).toFixed(0)} conditions/sec)`)

      // Transform trades (now uses both cached resolvers - instant lookups!)
      console.log('  🔄 Transforming trades...')
      const transformedTrades: PreparedTrade[] = []

      for (const event of rawEvents) {
        const transformed = await transformTrade(event, wallet, tokenResolver, conditionToMarketMap)
        if (transformed) {
          transformedTrades.push(transformed)
        }
      }

      console.log(`  ✅ Transformed ${transformedTrades.length}/${rawEvents.length} trades`)

      // Deduplicate
      console.log('  🔍 Checking for duplicates...')
      const batch = await dedupeAndPrepareInserts(transformedTrades, wallet)
      console.log(`  ✅ Found ${batch.new_count} new trades, ${batch.duplicate_count} duplicates`)

      // Insert new trades
      if (batch.new_count > 0) {
        console.log(`  📥 Inserting ${batch.new_count} new trades...`)
        await insertNewTradesToClickHouse(batch)
        console.log(`  ✅ Inserted successfully`)
      } else {
        console.log('  ⏭️  No new trades to insert')
      }

      // Update totals
      totalFetched += rawEvents.length
      totalInserted += batch.new_count
      totalDuplicates += batch.duplicate_count

      // Log progress
      const progressEntry: ProgressEntry = {
        wallet_address: wallet,
        wallet_index: i,
        fetched_count: rawEvents.length,
        inserted_count: batch.new_count,
        duplicates_skipped: batch.duplicate_count,
        hit_cap: hitCap,
        timestamp: new Date().toISOString(),
      }
      logProgress(progressEntry)

      // Save checkpoint
      const newCheckpoint: Checkpoint = {
        wallet_index: i,
        wallet_address: wallet,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        total_capped: totalCapped,
        timestamp: new Date().toISOString(),
      }
      await saveCheckpoint(newCheckpoint)

      // Rate limiting - wait between wallets
      if (i < wallets.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS)
      }
    } catch (error) {
      console.error(`  ❌ Error processing wallet ${wallet}:`, error)
      console.log('  ⚠️  Continuing to next wallet...')

      // Log failed attempt
      const progressEntry: ProgressEntry = {
        wallet_address: wallet,
        wallet_index: i,
        fetched_count: 0,
        inserted_count: 0,
        duplicates_skipped: 0,
        hit_cap: false,
        timestamp: new Date().toISOString(),
      }
      logProgress(progressEntry)

      // Save checkpoint even on error
      const newCheckpoint: Checkpoint = {
        wallet_index: i,
        wallet_address: wallet,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        total_capped: totalCapped,
        timestamp: new Date().toISOString(),
      }
      await saveCheckpoint(newCheckpoint)

      // Rate limiting even on error
      if (i < wallets.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS)
      }
    }
  }

  // Final summary
  const endTime = Date.now()
  const durationMs = endTime - startTime
  const durationHours = durationMs / (1000 * 60 * 60)

  console.log('\n\n✅ Goldsky recent trades load complete!')
  console.log('═'.repeat(60))
  console.log(`📊 Summary:`)
  console.log(`   Wallets processed: ${wallets.length - startIndex}`)
  console.log(`   Total trades fetched: ${totalFetched.toLocaleString()}`)
  console.log(`   Total trades inserted: ${totalInserted.toLocaleString()}`)
  console.log(`   Total duplicates skipped: ${totalDuplicates.toLocaleString()}`)
  console.log(`   Wallets hit ${MAX_TRADES_PER_WALLET} trade cap: ${totalCapped}`)
  console.log(`   Duration: ${durationHours.toFixed(2)} hours`)
  console.log(`   Average: ${(totalInserted / (durationMs / 1000 / 60)).toFixed(0)} trades/minute`)
  console.log('═'.repeat(60))
  console.log('\n📁 Output files:')
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log(`   Progress log: ${PROGRESS_LOG}`)
  console.log('\n📊 Next steps:')
  console.log('   1. Run full-enrichment-pass.ts to calculate realized P&L')
  console.log('   2. Run compute-wallet-metrics.ts to generate omega ratios')
  console.log('   3. (Optional) Run full historical backfill for wallets that hit cap')
}

// Execute main
main().catch(console.error)
