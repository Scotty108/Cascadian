/**
 * Goldsky Parallel Batch Ingestion
 *
 * Supports splitting the wallet list into N batches for parallel processing
 * Each batch runs independently with its own checkpoint file
 *
 * USAGE:
 *   npx tsx scripts/goldsky-parallel-batch.ts --batch=1 --of=3
 *   npx tsx scripts/goldsky-parallel-batch.ts --batch=2 --of=3
 *   npx tsx scripts/goldsky-parallel-batch.ts --batch=3 --of=3
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

const BATCH_NUM = parseInt(getArg('batch') || '1')
const TOTAL_BATCHES = parseInt(getArg('of') || '1')
const CONCURRENT_WORKERS = 10 // Reduced from 15 for stability
const BATCH_INSERT_SIZE = 10000
const CHECKPOINT_INTERVAL = 10
const CHECKPOINT_FILE = resolve(process.cwd(), `runtime/goldsky-batch${BATCH_NUM}.checkpoint.json`)
const PROGRESS_LOG = resolve(process.cwd(), `runtime/goldsky-batch${BATCH_NUM}.progress.jsonl`)
const SHARES_CORRECTION_FACTOR = 128

console.log(`\n🚀 BATCH ${BATCH_NUM} of ${TOTAL_BATCHES}`)
console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
console.log(`   Progress log: ${PROGRESS_LOG}\n`)

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
  batchNum: number
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

let globalCheckpoint: Checkpoint = {
  walletsProcessed: 0,
  lastWalletAddress: '',
  totalTradesInserted: 0,
  startTime: new Date().toISOString(),
  lastSaveTime: new Date().toISOString(),
  batchNum: BATCH_NUM,
}

let globalStats = {
  walletsProcessed: 0,
  tradesInserted: 0,
  errors: 0,
  skipped: 0,
}

const tokenIdCache = new Map<string, { condition: string; outcome: number } | null>()
const conditionToMarketCache = new Map<string, string>()

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

function saveCheckpoint() {
  try {
    globalCheckpoint.lastSaveTime = new Date().toISOString()
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(globalCheckpoint, null, 2))
  } catch (error) {
    console.error('⚠️  Failed to save checkpoint:', error)
  }
}

function logProgress(walletAddress: string, tradesCount: number, duration: number) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    wallet: walletAddress,
    trades: tradesCount,
    duration_ms: duration,
    total_processed: globalStats.walletsProcessed,
    batch: BATCH_NUM,
  }

  try {
    fs.appendFileSync(PROGRESS_LOG, JSON.stringify(logEntry) + '\n')
  } catch (error) {
    // Non-critical
  }
}

async function getTargetWallets(resumeFrom?: string): Promise<string[]> {
  console.log('📋 Loading wallet list from wallets_dim...')

  const query = `SELECT wallet_address FROM wallets_dim WHERE is_active = true ORDER BY wallet_address`

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = await result.json<{ wallet_address: string }>()
  let wallets = data.map((row) => row.wallet_address)

  // Filter for this batch
  const walletsPerBatch = Math.ceil(wallets.length / TOTAL_BATCHES)
  const startIdx = (BATCH_NUM - 1) * walletsPerBatch
  const endIdx = Math.min(BATCH_NUM * walletsPerBatch, wallets.length)

  wallets = wallets.slice(startIdx, endIdx)

  // Resume from checkpoint if exists
  if (resumeFrom) {
    const resumeIdx = wallets.findIndex(w => w > resumeFrom)
    if (resumeIdx > 0) {
      wallets = wallets.slice(resumeIdx)
    }
  }

  console.log(`✅ Batch ${BATCH_NUM}: ${wallets.length} wallets (indices ${startIdx}-${endIdx})`)
  if (resumeFrom) {
    console.log(`   Resuming after: ${resumeFrom}`)
  }

  return wallets
}

async function resolveTokenIdToCondition(tokenId: string): Promise<{ condition: string; outcome: number } | null> {
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  if (tokenId === '0') {
    return null
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

async function transformTrade(trade: OrderFilledEvent, walletAddress: string): Promise<PreparedTrade | null> {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      return null
    }

    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId
    const tokenInfo = await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    const marketId = await resolveConditionToMarket(tokenInfo.condition)
    if (!marketId) {
      return null
    }

    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let side: 'YES' | 'NO'
    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      if (makerIsToken) {
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    } else {
      if (takerIsToken) {
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    }

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

async function processWallet(walletAddress: string): Promise<WorkerStats> {
  const startTime = Date.now()
  const stats: WorkerStats = {
    walletsProcessed: 0,
    tradesInserted: 0,
    errors: 0,
  }

  try {
    const rawEvents = await fetchAllWalletTrades(walletAddress)

    if (rawEvents.length === 0) {
      globalStats.skipped++
      return stats
    }

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

    const duration = Date.now() - startTime
    logProgress(walletAddress, stats.tradesInserted, duration)

    return stats
  } catch (error) {
    stats.errors = 1
    return stats
  }
}

async function worker(walletQueue: string[], workerId: number): Promise<WorkerStats> {
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

    globalStats.walletsProcessed++
    globalStats.tradesInserted += walletStats.tradesInserted
    globalStats.errors += walletStats.errors

    globalCheckpoint.walletsProcessed = globalStats.walletsProcessed
    globalCheckpoint.lastWalletAddress = wallet
    globalCheckpoint.totalTradesInserted = globalStats.tradesInserted

    if (globalStats.walletsProcessed % CHECKPOINT_INTERVAL === 0) {
      saveCheckpoint()
      printProgress()
    }
  }

  return stats
}

function printProgress() {
  const startTime = new Date(globalCheckpoint.startTime).getTime()
  const elapsed = (Date.now() - startTime) / 1000 / 60
  const rate = globalStats.walletsProcessed / elapsed

  console.log(`\n📊 BATCH ${BATCH_NUM} PROGRESS`)
  console.log(`   Wallets: ${globalStats.walletsProcessed.toLocaleString()}`)
  console.log(`   Trades: ${globalStats.tradesInserted.toLocaleString()}`)
  console.log(`   Rate: ${rate.toFixed(2)} wallets/min`)
  console.log(`   Errors: ${globalStats.errors}, Skipped: ${globalStats.skipped}`)
}

async function main() {
  console.log('═'.repeat(80))
  console.log(`🚀 GOLDSKY BATCH ${BATCH_NUM}/${TOTAL_BATCHES} - PARALLEL INGESTION`)
  console.log('═'.repeat(80))
  console.log(`\n⚙️  Configuration:`)
  console.log(`   Concurrent workers: ${CONCURRENT_WORKERS}`)
  console.log(`   Batch insert size: ${BATCH_INSERT_SIZE.toLocaleString()}`)
  console.log('')

  try {
    const checkpoint = loadCheckpoint()
    if (checkpoint) {
      console.log('📂 Resuming from checkpoint:')
      console.log(`   Wallets: ${checkpoint.walletsProcessed}`)
      console.log(`   Last: ${checkpoint.lastWalletAddress}\n`)

      globalCheckpoint = checkpoint
      globalStats.walletsProcessed = checkpoint.walletsProcessed
      globalStats.tradesInserted = checkpoint.totalTradesInserted
    }

    const wallets = await getTargetWallets(checkpoint?.lastWalletAddress)

    if (wallets.length === 0) {
      console.log('✅ Batch complete!')
      return
    }

    console.log(`\n🚀 Starting ${CONCURRENT_WORKERS} workers...\n`)

    const walletQueue = [...wallets]
    const workerPromises: Promise<WorkerStats>[] = []

    for (let i = 0; i < CONCURRENT_WORKERS; i++) {
      workerPromises.push(worker(walletQueue, i))
    }

    await Promise.all(workerPromises)

    saveCheckpoint()

    console.log('\n' + '═'.repeat(80))
    console.log(`✅ BATCH ${BATCH_NUM} COMPLETE!`)
    console.log('═'.repeat(80))
    printProgress()

  } catch (error) {
    console.error('\n❌ Error:', error)
    saveCheckpoint()
    process.exit(1)
  }
}

main().catch(console.error)
