#!/usr/bin/env tsx
/**
 * Goldsky Full Historical Trade Load
 *
 * PURPOSE:
 * Fetch complete historical trade data from Goldsky GraphQL API for all target wallets.
 * De-duplicate against existing trades_raw data and insert only new trades.
 *
 * MODES:
 * 1. NORMAL MODE (default):
 *    - Loads wallets from ClickHouse trades_raw
 *    - Inserts new trades to ClickHouse
 *
 * 2. SHADOW MODE (--mode=shadow):
 *    - Loads wallets from JSONL file (--wallets-file)
 *    - Validates and writes trades to NDJSON backlog (--out)
 *    - NO ClickHouse writes (filesystem only)
 *    - Use this to discover and stage new wallets while Step D runs
 *
 * RESUME/CHECKPOINT DESIGN:
 * - Saves progress to checkpoint file after each wallet
 * - On restart, reads checkpoint and resumes from last processed wallet
 * - Progress logged to *.progress.jsonl (one line per wallet)
 *
 * SCOPE:
 * - Normal mode: All existing wallets in trades_raw
 * - Shadow mode: All wallets in provided --wallets-file
 * - Date range: All-time historical data
 * - Expected volume: 6-10M new trades (8-12 hours estimated)
 * - Downstream: these loaded trades will feed the resolution accuracy metric (did this wallet
 *   end up on the right side when the market resolved) once full-enrichment-pass.ts runs.
 *
 * USAGE:
 * Normal mode:
 *   npx tsx scripts/goldsky-full-historical-load.ts
 *
 * Shadow mode (while Step D runs):
 *   npx tsx scripts/goldsky-full-historical-load.ts \
 *     --mode=shadow \
 *     --wallets-file=runtime/discovered_wallets.jsonl \
 *     --out=runtime/ingest_backlog.jsonl \
 *     --checkpoint=runtime/goldsky-shadow.checkpoint.json
 *
 * SAFETY:
 * This script does not launch long-running ingestion loops or ClickHouse mutations automatically.
 * You must explicitly call main() to execute.
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

// Parse command-line arguments
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const MODE = getArg('mode') || 'normal' // 'normal' or 'shadow'
const WALLETS_FILE = getArg('wallets-file') || null
const OUTPUT_FILE = getArg('out') || null
const CHECKPOINT_FILE = getArg('checkpoint') || resolve(process.cwd(), 'runtime/goldsky-checkpoint.json')
const PROGRESS_LOG = CHECKPOINT_FILE.replace('.checkpoint.json', '.progress.jsonl')
const BATCH_INSERT_SIZE = 5000
const RATE_LIMIT_DELAY_MS = 100 // 100ms between wallets

// Known inflation bug in Goldsky data - shares are 128x too high
const SHARES_CORRECTION_FACTOR = 128

// Create Supabase client for market lookups
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RawTrade {
  id: string
  user: string // wallet address
  market: string // market identifier
  outcome: string // YES/NO
  shares: string
  price: string
  timestamp: number
  transactionHash: string
}

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
  timestamp: string
}

interface ProgressEntry {
  wallet_address: string
  wallet_index: number
  fetched_count: number
  inserted_count: number
  duplicates_skipped: number
  timestamp: string
}

// Cache for condition -> market_id mapping
const conditionToMarketCache = new Map<string, string>()

// Cache for token ID -> condition mapping
const tokenIdCache = new Map<string, { condition: string; outcome: number }>()

/**
 * Resolve condition ID to market ID using Supabase markets table
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
 */
async function resolveTokenIdToCondition(
  tokenId: string
): Promise<{ condition: string; outcome: number } | null> {
  // Check cache
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  // Token ID "0" is USDC collateral, not an outcome token
  if (tokenId === '0') {
    return null
  }

  // Query Goldsky positions subgraph
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
 * Transform OrderFilledEvent to PreparedTrade format
 */
async function transformTrade(
  trade: OrderFilledEvent,
  walletAddress: string
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
    const tokenInfo = await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    // Resolve condition to market
    const marketId = await resolveConditionToMarket(tokenInfo.condition)

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
      condition_id: tokenInfo.condition,
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
 * Fetch all historical trades for a single wallet from Goldsky
 * Uses the existing fetchAllWalletTrades helper with pagination built-in
 */
async function fetchAllTradesForWallet(wallet: string): Promise<OrderFilledEvent[]> {
  try {
    const trades = await fetchAllWalletTrades(wallet)
    return trades
  } catch (error) {
    console.error(`  ❌ Failed to fetch trades for ${wallet}:`, error)
    throw error
  }
}

/**
 * Append trades to NDJSON backlog file (shadow mode)
 */
function appendTradesToBacklog(trades: PreparedTrade[]): void {
  if (!OUTPUT_FILE || trades.length === 0) {
    return
  }

  try {
    // Ensure runtime directory exists
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    // Append each trade as a separate line
    for (const trade of trades) {
      const line = JSON.stringify(trade) + '\n'
      fs.appendFileSync(OUTPUT_FILE, line)
    }
  } catch (error) {
    console.error(`❌ Failed to append trades to backlog:`, error)
    throw error
  }
}

/**
 * De-duplicate trades against existing trades_raw data
 * Query ClickHouse for existing (transaction_hash, timestamp) tuples
 * In shadow mode, skip deduplication and return all trades
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

  // In shadow mode, skip deduplication (no ClickHouse queries)
  if (MODE === 'shadow') {
    return {
      trades: rawTrades,
      new_count: rawTrades.length,
      duplicate_count: 0,
    }
  }

  try {
    // Query ClickHouse for existing trade identifiers for this wallet
    // Use transaction_hash + timestamp as the unique identifier
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
      // Create composite key: transaction_hash:timestamp
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
 * In shadow mode, append to NDJSON backlog file instead
 * Batch insert 5000 rows at a time
 */
async function insertNewTradesToClickHouse(batch: PreparedInsertBatch): Promise<void> {
  if (batch.new_count === 0) {
    return
  }

  // In shadow mode, append to backlog file instead of ClickHouse
  if (MODE === 'shadow') {
    appendTradesToBacklog(batch.trades)
    console.log(`  📁 Appended ${batch.trades.length} trades to backlog: ${OUTPUT_FILE}`)
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
  // Ensure runtime directory exists
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
  // Ensure runtime directory exists
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  const line = JSON.stringify(progress) + '\n'
  fs.appendFileSync(PROGRESS_LOG, line)
}

/**
 * Load list of target wallets from ClickHouse
 * Query for distinct wallet_address from trades_raw
 */
async function getTargetWallets(): Promise<string[]> {
  try {
    console.log('📋 Loading target wallet list from ClickHouse...')

    const query = `
      SELECT DISTINCT wallet_address
      FROM trades_raw
      ORDER BY wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const data = (await result.json()) as any[]
    const wallets = data.map((row) => row.wallet_address)

    console.log(`✅ Found ${wallets.length} wallets in trades_raw`)
    return wallets
  } catch (error) {
    console.error('❌ Failed to load wallets from ClickHouse:', error)
    throw error
  }
}

/**
 * Load wallets from JSONL file (shadow mode)
 * Expected format: {"wallet": "0x...", ...} per line
 */
function loadWalletsFromFile(filePath: string): string[] {
  try {
    console.log(`📋 Loading wallet list from file: ${filePath}`)

    if (!fs.existsSync(filePath)) {
      throw new Error(`Wallets file not found: ${filePath}`)
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    const wallets: string[] = []

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        // Support both "wallet" and "wallet_address" fields
        const wallet = data.wallet || data.wallet_address
        if (wallet) {
          wallets.push(wallet.toLowerCase())
        }
      } catch (error) {
        console.warn(`⚠️  Failed to parse line: ${line}`)
      }
    }

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
  console.log('🌊 Goldsky Full Historical Trade Load\n')

  // Validate shadow mode arguments
  if (MODE === 'shadow') {
    console.log('🔒 SHADOW MODE ENABLED (READ-ONLY, filesystem only)')
    console.log('   No ClickHouse writes will be performed\n')

    if (!WALLETS_FILE) {
      throw new Error('Shadow mode requires --wallets-file argument')
    }
    if (!OUTPUT_FILE) {
      throw new Error('Shadow mode requires --out argument')
    }

    console.log(`   Wallets file: ${WALLETS_FILE}`)
    console.log(`   Output file:  ${OUTPUT_FILE}`)
    console.log(`   Checkpoint:   ${CHECKPOINT_FILE}\n`)
  } else {
    console.log('📊 NORMAL MODE - Writing to ClickHouse trades_raw\n')
  }

  // Load checkpoint if exists
  const checkpoint = loadCheckpoint()
  if (checkpoint) {
    console.log(`📌 Resuming from checkpoint:`)
    console.log(`   Last wallet: ${checkpoint.wallet_address}`)
    console.log(`   Wallet index: ${checkpoint.wallet_index}`)
    console.log(`   Total fetched: ${checkpoint.total_fetched}`)
    console.log(`   Total inserted: ${checkpoint.total_inserted}`)
    console.log(`   Total duplicates: ${checkpoint.total_duplicates}\n`)
  }

  // Get target wallets based on mode
  let wallets: string[]
  if (MODE === 'shadow') {
    wallets = loadWalletsFromFile(WALLETS_FILE!)
  } else {
    wallets = await getTargetWallets()
  }
  console.log(`📋 Target wallets: ${wallets.length}`)

  const startIndex = checkpoint ? checkpoint.wallet_index + 1 : 0
  let totalFetched = checkpoint ? checkpoint.total_fetched : 0
  let totalInserted = checkpoint ? checkpoint.total_inserted : 0
  let totalDuplicates = checkpoint ? checkpoint.total_duplicates : 0

  console.log(`\n🔄 Processing wallets ${startIndex} to ${wallets.length - 1}`)
  console.log(`⏱️  Rate limit: ${RATE_LIMIT_DELAY_MS}ms delay between wallets\n`)

  const startTime = Date.now()

  // Process each wallet
  for (let i = startIndex; i < wallets.length; i++) {
    const wallet = wallets[i]
    const progress = ((i + 1) / wallets.length) * 100

    console.log(`\n[${i + 1}/${wallets.length}] ${progress.toFixed(1)}% - Processing wallet: ${wallet}`)

    try {
      // Fetch trades from Goldsky
      console.log('  📡 Fetching trades from Goldsky...')
      const rawEvents = await fetchAllTradesForWallet(wallet)
      console.log(`  ✅ Fetched ${rawEvents.length} raw trade events`)

      if (rawEvents.length === 0) {
        console.log('  ⏭️  No trades found, skipping')

        // Log progress
        const progressEntry: ProgressEntry = {
          wallet_address: wallet,
          wallet_index: i,
          fetched_count: 0,
          inserted_count: 0,
          duplicates_skipped: 0,
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
          timestamp: new Date().toISOString(),
        }
        await saveCheckpoint(newCheckpoint)

        continue
      }

      // Transform trades
      console.log('  🔄 Transforming trades...')
      const transformedTrades: PreparedTrade[] = []

      for (const event of rawEvents) {
        const transformed = await transformTrade(event, wallet)
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

  console.log('\n\n✅ Goldsky load complete!')
  console.log('═'.repeat(60))
  console.log(`📊 Summary (${MODE.toUpperCase()} MODE):`)
  console.log(`   Wallets processed: ${wallets.length - startIndex}`)
  console.log(`   Total trades fetched: ${totalFetched.toLocaleString()}`)
  console.log(`   Total trades ${MODE === 'shadow' ? 'staged' : 'inserted'}: ${totalInserted.toLocaleString()}`)
  if (MODE !== 'shadow') {
    console.log(`   Total duplicates skipped: ${totalDuplicates.toLocaleString()}`)
  }
  console.log(`   Duration: ${durationHours.toFixed(2)} hours`)
  console.log(`   Average: ${(totalInserted / (durationMs / 1000 / 60)).toFixed(0)} trades/minute`)
  console.log('═'.repeat(60))
  console.log('\n📁 Output files:')
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log(`   Progress log: ${PROGRESS_LOG}`)
  if (MODE === 'shadow' && OUTPUT_FILE) {
    console.log(`   Backlog file: ${OUTPUT_FILE}`)
  }
  console.log('\n📊 Next steps:')
  if (MODE === 'shadow') {
    console.log('   1. Wait for Step D to complete')
    console.log('   2. Run report-wallet-delta.ts to compare discovered vs current wallets')
    console.log('   3. After gates pass, bulk-apply backlog to ClickHouse')
  } else {
    console.log('   1. Run full-enrichment-pass.ts to calculate realized P&L and resolution accuracy')
    console.log('   2. Verify data completeness with check-strategy-count.ts')
  }
}

// DO NOT auto-execute
// Call main() explicitly when ready
