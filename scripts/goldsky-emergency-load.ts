#!/usr/bin/env tsx
/**
 * EMERGENCY FAST LOAD - Bypass Goldsky Positions API
 *
 * PROBLEM: Goldsky positions API is down (503 errors)
 * SOLUTION: Load trades WITHOUT token ID resolution
 *
 * TRADEOFFS:
 * - Trades inserted with EMPTY market_id (will be backfilled by enrichment)
 * - Trades inserted with PLACEHOLDER condition_id derived from token ID
 * - No immediate side (YES/NO) determination
 * - Gets data INTO database fast, enrichment fixes it later
 *
 * USAGE:
 *   npx tsx scripts/goldsky-emergency-load.ts --wallets-file=runtime/wallets_10k_plus_addresses.txt
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { fetchWalletTrades, OrderFilledEvent } from '@/lib/goldsky/client'

// Command-line arguments
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const WALLETS_FILE = getArg('wallets-file') || null
const CHECKPOINT_ARG = getArg('checkpoint')
const CHECKPOINT_FILE = CHECKPOINT_ARG
  ? resolve(process.cwd(), CHECKPOINT_ARG)
  : resolve(process.cwd(), 'runtime/goldsky-emergency.checkpoint.json')
const PROGRESS_LOG = CHECKPOINT_FILE.replace('.checkpoint.json', '.progress.jsonl')
const BATCH_INSERT_SIZE = 5000
const RATE_LIMIT_DELAY_MS = 50 // Faster - 50ms between wallets

// OPTIMIZATION PARAMETERS
const MAX_TRADES_PER_WALLET = 5000
const DAYS_LOOKBACK = 365
const MIN_TIMESTAMP = Math.floor(Date.now() / 1000) - (DAYS_LOOKBACK * 24 * 60 * 60)

// Shares correction
const SHARES_CORRECTION_FACTOR = 128

interface PreparedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string
  timestamp: number
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
  realized_pnl_usd: number
  is_resolved: number
}

interface Checkpoint {
  wallet_index: number
  wallet_address: string
  total_fetched: number
  total_inserted: number
  total_duplicates: number
  total_capped: number
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

/**
 * EMERGENCY: Transform trade WITHOUT Goldsky positions API
 * Uses token IDs as placeholder condition_ids
 * Assumes YES side for all trades (enrichment will fix)
 */
function emergencyTransformTrade(
  trade: OrderFilledEvent,
  walletAddress: string
): PreparedTrade | null {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    // Determine which asset is the outcome token (not USDC)
    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      return null // Both USDC, skip
    }

    // Get token ID - use as placeholder condition_id
    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId

    // Calculate amounts
    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      if (makerIsToken) {
        // Maker gave tokens, received USDC - SELL
        shares = makerAmount
        usdValue = takerAmount
      } else {
        // Maker gave USDC, received tokens - BUY
        shares = takerAmount
        usdValue = makerAmount
      }
    } else {
      if (takerIsToken) {
        // Taker gave tokens, received USDC - SELL
        shares = takerAmount
        usdValue = makerAmount
      } else {
        // Taker gave USDC, received tokens - BUY
        shares = makerAmount
        usdValue = takerAmount
      }
    }

    price = usdValue / shares
    const correctedShares = shares / SHARES_CORRECTION_FACTOR

    return {
      trade_id: trade.id,
      wallet_address: walletAddress.toLowerCase(),
      market_id: '', // EMPTY - enrichment will backfill
      condition_id: `token_${tokenId}`, // Placeholder - enrichment will fix
      timestamp: parseInt(trade.timestamp),
      side: 'YES', // Placeholder - enrichment will determine actual side
      entry_price: price,
      shares: correctedShares,
      usd_value: price * correctedShares,
      transaction_hash: trade.transactionHash,
      is_closed: false,
      realized_pnl_usd: 0,
      is_resolved: 0,
    }
  } catch (error) {
    return null
  }
}

/**
 * Fetch recent trades (same as optimized version)
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

      if (trades.length === 0) break

      const recentTrades = trades.filter(t => parseInt(t.timestamp) >= MIN_TIMESTAMP)
      allTrades.push(...recentTrades)

      if (trades.length < fetchSize) break

      const lastTradeTimestamp = parseInt(trades[trades.length - 1].timestamp)
      if (lastTradeTimestamp < MIN_TIMESTAMP) break

      if (allTrades.length >= MAX_TRADES_PER_WALLET) {
        hitCap = true
        break
      }

      skip += batchSize
    }

    return {
      trades: allTrades.slice(0, MAX_TRADES_PER_WALLET),
      hitCap: hitCap || allTrades.length === MAX_TRADES_PER_WALLET
    }
  } catch (error) {
    console.error(`  ❌ Failed to fetch trades for ${wallet}:`, error)
    throw error
  }
}

async function dedupeAndPrepareInserts(
  rawTrades: PreparedTrade[],
  walletAddress: string
): Promise<{ trades: PreparedTrade[]; new_count: number; duplicate_count: number }> {
  if (rawTrades.length === 0) {
    return { trades: [], new_count: 0, duplicate_count: 0 }
  }

  try {
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

async function insertNewTradesToClickHouse(batch: { trades: PreparedTrade[]; new_count: number; duplicate_count: number }): Promise<void> {
  if (batch.new_count === 0) return

  try {
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

function saveCheckpoint(checkpoint: Checkpoint): void {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

function loadCheckpoint(): Checkpoint | null {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
  }
  return null
}

function logProgress(progress: ProgressEntry): void {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }
  const line = JSON.stringify(progress) + '\n'
  fs.appendFileSync(PROGRESS_LOG, line)
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('🚨 EMERGENCY FAST LOAD - Bypassing Goldsky Positions API\n')
  console.log('⚡ SETTINGS:')
  console.log(`   Max trades per wallet: ${MAX_TRADES_PER_WALLET.toLocaleString()}`)
  console.log(`   Lookback period: ${DAYS_LOOKBACK} days`)
  console.log(`   Rate limit: ${RATE_LIMIT_DELAY_MS}ms`)
  console.log(`   ⚠️  market_id will be EMPTY (enrichment will backfill)`)
  console.log(`   ⚠️  condition_id will be placeholder (enrichment will fix)`)
  console.log('')

  if (!WALLETS_FILE) {
    throw new Error('--wallets-file argument required')
  }

  const checkpoint = loadCheckpoint()
  if (checkpoint) {
    console.log(`📌 Resuming from checkpoint:`)
    console.log(`   Last wallet: ${checkpoint.wallet_address}`)
    console.log(`   Wallet index: ${checkpoint.wallet_index}\n`)
  }

  const wallets = loadWalletsFromFile(WALLETS_FILE)
  console.log(`📋 Target wallets: ${wallets.length}\n`)

  const startIndex = checkpoint ? checkpoint.wallet_index + 1 : 0
  let totalFetched = checkpoint ? checkpoint.total_fetched : 0
  let totalInserted = checkpoint ? checkpoint.total_inserted : 0
  let totalDuplicates = checkpoint ? checkpoint.total_duplicates : 0
  let totalCapped = checkpoint ? checkpoint.total_capped : 0

  console.log(`🔄 Processing wallets ${startIndex} to ${wallets.length - 1}\n`)

  const startTime = Date.now()

  for (let i = startIndex; i < wallets.length; i++) {
    const wallet = wallets[i]
    const progress = ((i + 1) / wallets.length) * 100

    console.log(`\n[${i + 1}/${wallets.length}] ${progress.toFixed(1)}% - Processing: ${wallet}`)

    try {
      console.log('  📡 Fetching recent trades...')
      const { trades: rawEvents, hitCap } = await fetchRecentTradesForWallet(wallet)

      const capIndicator = hitCap ? ' 🔴 HIT CAP' : ''
      console.log(`  ✅ Fetched ${rawEvents.length} trades${capIndicator}`)

      if (hitCap) totalCapped++

      if (rawEvents.length === 0) {
        console.log('  ⏭️  No trades, skipping')

        logProgress({
          wallet_address: wallet,
          wallet_index: i,
          fetched_count: 0,
          inserted_count: 0,
          duplicates_skipped: 0,
          hit_cap: false,
          timestamp: new Date().toISOString(),
        })

        saveCheckpoint({
          wallet_index: i,
          wallet_address: wallet,
          total_fetched: totalFetched,
          total_inserted: totalInserted,
          total_duplicates: totalDuplicates,
          total_capped: totalCapped,
          timestamp: new Date().toISOString(),
        })

        continue
      }

      console.log('  ⚡ Emergency transform (no API calls)...')
      const transformedTrades: PreparedTrade[] = []

      for (const event of rawEvents) {
        const transformed = emergencyTransformTrade(event, wallet)
        if (transformed) {
          transformedTrades.push(transformed)
        }
      }

      console.log(`  ✅ Transformed ${transformedTrades.length}/${rawEvents.length} trades`)

      console.log('  🔍 Deduplicating...')
      const batch = await dedupeAndPrepareInserts(transformedTrades, wallet)
      console.log(`  ✅ ${batch.new_count} new, ${batch.duplicate_count} duplicates`)

      if (batch.new_count > 0) {
        console.log(`  📥 Inserting ${batch.new_count} trades...`)
        await insertNewTradesToClickHouse(batch)
        console.log(`  ✅ Inserted`)
      }

      totalFetched += rawEvents.length
      totalInserted += batch.new_count
      totalDuplicates += batch.duplicate_count

      logProgress({
        wallet_address: wallet,
        wallet_index: i,
        fetched_count: rawEvents.length,
        inserted_count: batch.new_count,
        duplicates_skipped: batch.duplicate_count,
        hit_cap: hitCap,
        timestamp: new Date().toISOString(),
      })

      saveCheckpoint({
        wallet_index: i,
        wallet_address: wallet,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        total_capped: totalCapped,
        timestamp: new Date().toISOString(),
      })

      if (i < wallets.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS)
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error}`)
      console.log('  ⚠️  Continuing...')

      logProgress({
        wallet_address: wallet,
        wallet_index: i,
        fetched_count: 0,
        inserted_count: 0,
        duplicates_skipped: 0,
        hit_cap: false,
        timestamp: new Date().toISOString(),
      })

      saveCheckpoint({
        wallet_index: i,
        wallet_address: wallet,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        total_capped: totalCapped,
        timestamp: new Date().toISOString(),
      })

      if (i < wallets.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS)
      }
    }
  }

  const endTime = Date.now()
  const durationHours = (endTime - startTime) / (1000 * 60 * 60)

  console.log('\n\n✅ EMERGENCY LOAD COMPLETE!')
  console.log('═'.repeat(60))
  console.log(`📊 Summary:`)
  console.log(`   Wallets processed: ${wallets.length - startIndex}`)
  console.log(`   Total trades fetched: ${totalFetched.toLocaleString()}`)
  console.log(`   Total trades inserted: ${totalInserted.toLocaleString()}`)
  console.log(`   Wallets hit cap: ${totalCapped}`)
  console.log(`   Duration: ${durationHours.toFixed(2)} hours`)
  console.log('═'.repeat(60))
  console.log('\n📝 NEXT STEPS:')
  console.log('   1. Run enrichment pipeline to backfill market_ids and condition_ids')
  console.log('   2. Run metrics computation')
  console.log('   3. Data will be fully enriched once Goldsky API recovers')
}

main().catch(console.error)
