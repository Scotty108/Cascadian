#!/usr/bin/env tsx
/**
 * Discover Wallets from Goldsky PnL Subgraph (NO CLICKHOUSE)
 *
 * PURPOSE:
 * Query Goldsky's userPositions to discover all wallets with trading activity.
 * Aggregates totalBought (volume) per wallet and filters by minimum thresholds.
 *
 * DATA SOURCE: Goldsky PnL subgraph ONLY (no ClickHouse queries)
 *
 * OUTPUT:
 * - runtime/discovered_wallets.jsonl (one wallet per line with volume/pnl)
 * - runtime/discover-wallets-goldsky.checkpoint.json (resume state)
 *
 * USAGE:
 * npx tsx scripts/discover-wallets-from-goldsky.ts --min-volume=100 --min-trades=1
 * npx tsx scripts/discover-wallets-from-goldsky.ts --resume
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { GraphQLClient } from 'graphql-request'

const GOLDSKY_PNL_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
const OUTPUT_FILE = resolve(process.cwd(), 'runtime/discovered_wallets.jsonl')
const CHECKPOINT_FILE = resolve(process.cwd(), 'runtime/discover-wallets-goldsky.checkpoint.json')

const PAGE_SIZE = 1000
const MIN_VOLUME_USD = parseFloat(process.argv.find(a => a.startsWith('--min-volume='))?.split('=')[1] || '100')
const MIN_TRADES = parseInt(process.argv.find(a => a.startsWith('--min-trades='))?.split('=')[1] || '1')
const RESUME = process.argv.includes('--resume')
const RATE_LIMIT_DELAY = 100 // ms between requests

interface UserPosition {
  id: string
  user: string
  tokenId: string
  totalBought: string
  realizedPnl: string
}

interface WalletAggregate {
  wallet: string
  totalVolume: number
  totalPnL: number
  numPositions: number
}

interface Checkpoint {
  lastId: string
  totalPositions: number
  totalWallets: number
  timestamp: string
}

const client = new GraphQLClient(GOLDSKY_PNL_ENDPOINT)

// Query to get userPositions paginated
const GET_POSITIONS_QUERY = /* GraphQL */ `
  query GetPositions($lastId: String!, $limit: Int!) {
    userPositions(
      first: $limit
      where: { id_gt: $lastId }
      orderBy: id
      orderDirection: asc
    ) {
      id
      user
      tokenId
      totalBought
      realizedPnl
    }
  }
`

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
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

function appendWallet(wallet: WalletAggregate) {
  const line = JSON.stringify(wallet) + '\n'
  fs.appendFileSync(OUTPUT_FILE, line)
}

async function main() {
  console.log('🔍 Wallet Discovery from Goldsky (NO CLICKHOUSE)')
  console.log(`   Output: ${OUTPUT_FILE}`)
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log(`   Filters: minVolume >= $${MIN_VOLUME_USD}, minTrades >= ${MIN_TRADES}\n`)

  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  let checkpoint = RESUME ? loadCheckpoint() : null
  let lastId = checkpoint?.lastId || ''
  let totalPositions = checkpoint?.totalPositions || 0
  let pageIndex = 0

  if (checkpoint) {
    console.log(`✅ Resuming from checkpoint: ${checkpoint.totalPositions} positions, ${checkpoint.totalWallets} wallets\n`)
  } else {
    console.log('⚠️  No checkpoint found, starting fresh\n')
    // Clear output file if starting fresh
    if (fs.existsSync(OUTPUT_FILE)) {
      fs.unlinkSync(OUTPUT_FILE)
    }
  }

  // Aggregate positions by wallet
  const walletAggregates = new Map<string, WalletAggregate>()

  let hasMore = true
  const startTime = Date.now()

  while (hasMore) {
    try {
      pageIndex++
      console.log(`   Fetching page ${pageIndex} (after ${lastId || 'start'})...`)

      const data = await client.request<{ userPositions: UserPosition[] }>(
        GET_POSITIONS_QUERY,
        {
          lastId,
          limit: PAGE_SIZE
        }
      )

      const positions = data.userPositions || []

      if (positions.length === 0) {
        hasMore = false
        console.log('   No more positions found.')
        break
      }

      // Aggregate by wallet
      for (const pos of positions) {
        const wallet = pos.user.toLowerCase()
        const volume = parseFloat(pos.totalBought)
        const pnl = parseFloat(pos.realizedPnl)

        if (!walletAggregates.has(wallet)) {
          walletAggregates.set(wallet, {
            wallet,
            totalVolume: 0,
            totalPnL: 0,
            numPositions: 0
          })
        }

        const agg = walletAggregates.get(wallet)!
        agg.totalVolume += volume
        agg.totalPnL += pnl
        agg.numPositions += 1
      }

      totalPositions += positions.length
      lastId = positions[positions.length - 1].id

      console.log(`   Processed ${positions.length} positions, ${walletAggregates.size} unique wallets so far`)

      // Save checkpoint every 10 pages
      if (pageIndex % 10 === 0) {
        saveCheckpoint({
          lastId,
          totalPositions,
          totalWallets: walletAggregates.size,
          timestamp: new Date().toISOString()
        })
        console.log(`   💾 Checkpoint saved (${totalPositions} positions, ${walletAggregates.size} wallets)`)
      }

      // Check if we got fewer than requested (last page)
      if (positions.length < PAGE_SIZE) {
        hasMore = false
        console.log('   Reached end of data.')
        break
      }

      // Rate limiting
      await sleep(RATE_LIMIT_DELAY)

    } catch (error) {
      console.error(`❌ Error fetching page ${pageIndex}:`, error)
      console.log('   Saving checkpoint before exit...')
      saveCheckpoint({
        lastId,
        totalPositions,
        totalWallets: walletAggregates.size,
        timestamp: new Date().toISOString()
      })
      throw error
    }
  }

  // Filter and write wallets
  console.log(`\n📊 Filtering wallets...`)
  console.log(`   Total unique wallets: ${walletAggregates.size}`)

  let passedCount = 0
  for (const [wallet, agg] of walletAggregates.entries()) {
    if (agg.totalVolume >= MIN_VOLUME_USD && agg.numPositions >= MIN_TRADES) {
      appendWallet(agg)
      passedCount++
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`\n✅ Discovery complete in ${elapsedSec}s`)
  console.log(`   Total positions processed: ${totalPositions.toLocaleString()}`)
  console.log(`   Total unique wallets: ${walletAggregates.size.toLocaleString()}`)
  console.log(`   Wallets passing filters: ${passedCount.toLocaleString()}`)
  console.log(`   Output: ${OUTPUT_FILE}`)

  // Final checkpoint
  saveCheckpoint({
    lastId,
    totalPositions,
    totalWallets: walletAggregates.size,
    timestamp: new Date().toISOString()
  })
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
