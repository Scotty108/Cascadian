#!/usr/bin/env tsx
/**
 * Fast Wallet Discovery from Goldsky Orderbook (NO CLICKHOUSE)
 *
 * PURPOSE:
 * Query Goldsky's orderbook subgraph (orderFilledEvents) to discover all wallets
 * and calculate their lifetime USD volume. Supports resume and auto-stopping.
 *
 * DATA SOURCE: Goldsky orderbook subgraph ONLY (no ClickHouse)
 *
 * FEATURES:
 * - Checkpoint/resume: saves state every 200k events
 * - Auto-stop: when new wallet discovery rate < 0.5% over last 200k events
 * - Incremental threshold updates every 200k events
 * - Configurable max events (0 = unlimited)
 *
 * VOLUME CALCULATION:
 * For each orderFilledEvent:
 * - If user is maker: volume = makerAmountFilled (in USDC, 6 decimals)
 * - If user is taker: volume = takerAmountFilled (in USDC, 6 decimals)
 * Aggregate per wallet across all trades.
 *
 * OUTPUT:
 * - runtime/discovered_wallets.jsonl (wallet, totalVolume, numTrades)
 * - runtime/wallet_thresholds_universe.{json,csv} (updated every 200k events)
 * - runtime/discover-orderbook.checkpoint.json (resume state)
 *
 * USAGE:
 * npx tsx scripts/discover-wallets-orderbook-fast.ts --max-events=0 --resume
 * npx tsx scripts/discover-wallets-orderbook-fast.ts --max-events=5000000 --min-volume=100
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { GraphQLClient } from 'graphql-request'

const GOLDSKY_ORDERBOOK_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
const OUTPUT_FILE = resolve(process.cwd(), 'runtime/discovered_wallets.jsonl')
const CHECKPOINT_FILE = resolve(process.cwd(), 'runtime/discover-orderbook.checkpoint.json')
const THRESHOLDS_JSON = resolve(process.cwd(), 'runtime/wallet_thresholds_universe.json')
const THRESHOLDS_CSV = resolve(process.cwd(), 'runtime/wallet_thresholds_universe.csv')

const PAGE_SIZE = 1000
const MIN_VOLUME_USD = parseFloat(process.argv.find(a => a.startsWith('--min-volume='))?.split('=')[1] || '100')
const MAX_EVENTS = parseInt(process.argv.find(a => a.startsWith('--max-events='))?.split('=')[1] || '0')
const RESUME = process.argv.includes('--resume')
const RATE_LIMIT_DELAY = 100
const CHECKPOINT_INTERVAL = 200000 // Save every 200k events
const AUTO_STOP_THRESHOLD = 0.005 // Stop if new wallet rate < 0.5%

// USDC has 6 decimals
const USDC_DECIMALS = 1e6

interface OrderFilledEvent {
  id: string
  maker: string
  taker: string
  makerAmountFilled: string
  takerAmountFilled: string
  timestamp: string
}

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

interface Checkpoint {
  lastTimestamp: string
  totalEvents: number
  totalWallets: number
  walletsAtLastCheckpoint: number
  timestamp: string
  walletStats: Record<string, WalletStats>
}

const client = new GraphQLClient(GOLDSKY_ORDERBOOK_ENDPOINT)

const GET_ORDERS_QUERY = /* GraphQL */ `
  query GetOrders($lastTimestamp: String!, $limit: Int!) {
    orderFilledEvents(
      first: $limit
      where: { timestamp_gt: $lastTimestamp }
      orderBy: timestamp
      orderDirection: asc
    ) {
      id
      maker
      taker
      makerAmountFilled
      takerAmountFilled
      timestamp
    }
  }
`

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.warn('⚠️  Failed to load checkpoint:', error)
  }
  return null
}

function saveCheckpoint(checkpoint: Checkpoint) {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

function computeAndWriteThresholds(
  walletStatsMap: Map<string, WalletStats>,
  totalEvents: number
) {
  const wallets = Array.from(walletStatsMap.values())
  const total = wallets.length

  const ge_100 = wallets.filter(w => w.totalVolume >= 100).length
  const ge_500 = wallets.filter(w => w.totalVolume >= 500).length
  const ge_1k = wallets.filter(w => w.totalVolume >= 1000).length
  const ge_5k = wallets.filter(w => w.totalVolume >= 5000).length
  const ge_10k = wallets.filter(w => w.totalVolume >= 10000).length

  // JSON output
  const jsonOutput = {
    data_source: 'Goldsky orderbook subgraph (orderFilledEvents)',
    discovery_method: 'Aggregated maker/taker amounts (NO ClickHouse)',
    total_wallets_discovered: total,
    total_events_processed: totalEvents,
    last_updated: new Date().toISOString(),
    thresholds: {
      ge_100: { count: ge_100, pct: ((ge_100 / total) * 100).toFixed(2) },
      ge_500: { count: ge_500, pct: ((ge_500 / total) * 100).toFixed(2) },
      ge_1000: { count: ge_1k, pct: ((ge_1k / total) * 100).toFixed(2) },
      ge_5000: { count: ge_5k, pct: ((ge_5k / total) * 100).toFixed(2) },
      ge_10000: { count: ge_10k, pct: ((ge_10k / total) * 100).toFixed(2) }
    }
  }
  fs.writeFileSync(THRESHOLDS_JSON, JSON.stringify(jsonOutput, null, 2))

  // CSV output
  const csvLines = [
    'threshold,wallets_ge_threshold,pct_of_total,total_discovered'
  ]
  csvLines.push(`100,${ge_100},${((ge_100/total)*100).toFixed(2)},${total}`)
  csvLines.push(`500,${ge_500},${((ge_500/total)*100).toFixed(2)},${total}`)
  csvLines.push(`1000,${ge_1k},${((ge_1k/total)*100).toFixed(2)},${total}`)
  csvLines.push(`5000,${ge_5k},${((ge_5k/total)*100).toFixed(2)},${total}`)
  csvLines.push(`10000,${ge_10k},${((ge_10k/total)*100).toFixed(2)},${total}`)
  fs.writeFileSync(THRESHOLDS_CSV, csvLines.join('\n'))

  return { ge_100, ge_500, ge_1k, ge_5k, ge_10k }
}

async function main() {
  console.log('🔍 Fast Wallet Discovery from Goldsky Orderbook (NO CLICKHOUSE)')
  console.log(`   Max events: ${MAX_EVENTS === 0 ? 'unlimited' : MAX_EVENTS.toLocaleString()}`)
  console.log(`   Min volume: $${MIN_VOLUME_USD}`)
  console.log(`   Resume: ${RESUME}\n`)

  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  // Load checkpoint if resuming
  let checkpoint = RESUME ? loadCheckpoint() : null
  let walletStats = new Map<string, WalletStats>()
  let lastTimestamp = '0'
  let totalEvents = 0
  let walletsAtLastCheckpoint = 0

  if (checkpoint) {
    console.log(`✅ Resuming from checkpoint:`)
    console.log(`   Last timestamp: ${checkpoint.lastTimestamp}`)
    console.log(`   Events processed: ${checkpoint.totalEvents.toLocaleString()}`)
    console.log(`   Wallets discovered: ${checkpoint.totalWallets.toLocaleString()}\n`)

    lastTimestamp = checkpoint.lastTimestamp
    totalEvents = checkpoint.totalEvents
    walletsAtLastCheckpoint = checkpoint.walletsAtLastCheckpoint

    // Restore wallet stats
    for (const [wallet, stats] of Object.entries(checkpoint.walletStats)) {
      walletStats.set(wallet, stats)
    }
  } else {
    console.log('⚠️  No checkpoint found, starting fresh\n')
    // Clear output file
    if (fs.existsSync(OUTPUT_FILE)) {
      fs.unlinkSync(OUTPUT_FILE)
    }
  }

  let pageIndex = 0
  let hasMore = true
  const startTime = Date.now()
  let lastCheckpointEvents = totalEvents

  console.log('📊 Fetching order events...\n')

  while (hasMore) {
    try {
      pageIndex++

      const data = await client.request<{ orderFilledEvents: OrderFilledEvent[] }>(
        GET_ORDERS_QUERY,
        {
          lastTimestamp,
          limit: PAGE_SIZE
        }
      )

      const events = data.orderFilledEvents || []

      if (events.length === 0) {
        console.log('\n📋 Reached end of orderbook data')
        hasMore = false
        break
      }

      // Process events
      for (const event of events) {
        const maker = event.maker.toLowerCase()
        const taker = event.taker.toLowerCase()

        const makerAmount = parseFloat(event.makerAmountFilled) / USDC_DECIMALS
        const takerAmount = parseFloat(event.takerAmountFilled) / USDC_DECIMALS

        if (!walletStats.has(maker)) {
          walletStats.set(maker, { wallet: maker, totalVolume: 0, numTrades: 0 })
        }
        const makerStat = walletStats.get(maker)!
        makerStat.totalVolume += makerAmount
        makerStat.numTrades += 1

        if (!walletStats.has(taker)) {
          walletStats.set(taker, { wallet: taker, totalVolume: 0, numTrades: 0 })
        }
        const takerStat = walletStats.get(taker)!
        takerStat.totalVolume += takerAmount
        takerStat.numTrades += 1
      }

      totalEvents += events.length
      lastTimestamp = events[events.length - 1].timestamp

      // Checkpoint every 200k events
      if (totalEvents - lastCheckpointEvents >= CHECKPOINT_INTERVAL) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const walletsNow = walletStats.size
        const walletsAdded = walletsNow - walletsAtLastCheckpoint
        const discoveryRate = walletsAdded / CHECKPOINT_INTERVAL

        console.log(`\n📊 Checkpoint at ${totalEvents.toLocaleString()} events (${elapsed}s):`)
        console.log(`   Total wallets: ${walletsNow.toLocaleString()}`)
        console.log(`   New wallets (last ${(CHECKPOINT_INTERVAL/1000).toFixed(0)}k): ${walletsAdded.toLocaleString()}`)
        console.log(`   Discovery rate: ${(discoveryRate * 100).toFixed(3)}%`)

        // Compute and write thresholds
        const thresholds = computeAndWriteThresholds(walletStats, totalEvents)
        console.log(`   ≥$100: ${thresholds.ge_100.toLocaleString()}, ≥$500: ${thresholds.ge_500.toLocaleString()}, ≥$1k: ${thresholds.ge_1k.toLocaleString()}, ≥$5k: ${thresholds.ge_5k.toLocaleString()}, ≥$10k: ${thresholds.ge_10k.toLocaleString()}`)

        // Save checkpoint
        const walletStatsObj: Record<string, WalletStats> = {}
        for (const [wallet, stats] of walletStats.entries()) {
          walletStatsObj[wallet] = stats
        }
        saveCheckpoint({
          lastTimestamp,
          totalEvents,
          totalWallets: walletsNow,
          walletsAtLastCheckpoint: walletsNow,
          timestamp: new Date().toISOString(),
          walletStats: walletStatsObj
        })
        console.log(`   💾 Checkpoint saved\n`)

        // Auto-stop check
        if (discoveryRate < AUTO_STOP_THRESHOLD) {
          console.log(`\n🛑 Auto-stopping: discovery rate ${(discoveryRate * 100).toFixed(3)}% < ${(AUTO_STOP_THRESHOLD * 100).toFixed(1)}% threshold`)
          hasMore = false
          break
        }

        lastCheckpointEvents = totalEvents
        walletsAtLastCheckpoint = walletsNow
      }

      // Check max events limit
      if (MAX_EVENTS > 0 && totalEvents >= MAX_EVENTS) {
        console.log(`\n📋 Reached max events limit: ${MAX_EVENTS.toLocaleString()}`)
        hasMore = false
        break
      }

      if (events.length < PAGE_SIZE) {
        hasMore = false
        break
      }

      await sleep(RATE_LIMIT_DELAY)

    } catch (error) {
      console.error(`\n❌ Error on page ${pageIndex}:`, error)
      console.log('   Saving checkpoint before exit...')
      const walletStatsObj: Record<string, WalletStats> = {}
      for (const [wallet, stats] of walletStats.entries()) {
        walletStatsObj[wallet] = stats
      }
      saveCheckpoint({
        lastTimestamp,
        totalEvents,
        totalWallets: walletStats.size,
        walletsAtLastCheckpoint,
        timestamp: new Date().toISOString(),
        walletStats: walletStatsObj
      })
      throw error
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`\n✅ Discovery complete in ${elapsedSec}s`)
  console.log(`   Total events: ${totalEvents.toLocaleString()}`)
  console.log(`   Total unique wallets: ${walletStats.size.toLocaleString()}\n`)

  // Final threshold computation
  console.log(`📊 Final threshold computation...`)
  computeAndWriteThresholds(walletStats, totalEvents)

  // Write all wallets to JSONL
  console.log(`📝 Writing discovered wallets to JSONL...\n`)
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE)
  }

  let written = 0
  for (const [wallet, stats] of walletStats.entries()) {
    if (stats.totalVolume >= MIN_VOLUME_USD) {
      const line = JSON.stringify(stats) + '\n'
      fs.appendFileSync(OUTPUT_FILE, line)
      written++
    }
  }

  console.log(`✅ Final results:`)
  console.log(`   Total wallets discovered: ${walletStats.size.toLocaleString()}`)
  console.log(`   Wallets ≥ $${MIN_VOLUME_USD}: ${written.toLocaleString()}`)
  console.log(`   Output: ${OUTPUT_FILE}`)
  console.log(`   Thresholds: ${THRESHOLDS_JSON}`)
  console.log(`   CSV: ${THRESHOLDS_CSV}`)
  console.log(`\n✅ CONFIRMED: NO ClickHouse queries - Goldsky only`)
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
