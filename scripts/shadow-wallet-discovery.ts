#!/usr/bin/env tsx
/**
 * Shadow Wallet Discovery (SAFE - NO CLICKHOUSE WRITES)
 *
 * PURPOSE:
 * Discover ALL distinct trader addresses from Goldsky orderbook for Phase 2 expansion.
 * This is a READ-ONLY shadow operation while Step D runs.
 *
 * OUTPUTS:
 * - runtime/shadow_wallet_universe.jsonl (one address per line)
 * - runtime/shadow_wallet_universe.stats.json (counts and metadata)
 * - runtime/shadow_wallet_universe.sample.json (10 sample addresses)
 *
 * STRATEGY:
 * Query Goldsky orderbook for all orderFilledEvents, extract unique maker/taker addresses.
 * Since Goldsky limits to 1000 results per query, we'll paginate through all trades.
 *
 * SAFETY: NO ClickHouse writes. Pure discovery.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { GraphQLClient } from 'graphql-request'
import { GOLDSKY_ENDPOINTS } from '@/lib/goldsky/client'

const RUNTIME_DIR = resolve(process.cwd(), 'runtime')
const OUTPUT_JSONL = resolve(RUNTIME_DIR, 'shadow_wallet_universe.jsonl')
const OUTPUT_STATS = resolve(RUNTIME_DIR, 'shadow_wallet_universe.stats.json')
const OUTPUT_SAMPLE = resolve(RUNTIME_DIR, 'shadow_wallet_universe.sample.json')
const CURRENT_WALLETS = resolve(RUNTIME_DIR, 'current_wallets.jsonl')

const BATCH_SIZE = 1000
const RATE_LIMIT_DELAY_MS = 100 // Be gentle with Goldsky

const orderbookClient = new GraphQLClient(GOLDSKY_ENDPOINTS.orders)

// Query to get all order events with pagination
const GET_ALL_TRADERS = /* GraphQL */ `
  query GetAllTraders($limit: Int!, $skip: Int!) {
    orderFilledEvents(
      first: $limit
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      maker
      taker
      timestamp
    }
  }
`

interface OrderEvent {
  maker: string
  taker: string
  timestamp: string
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function discoverAllTraders() {
  console.log('🔍 Shadow Wallet Discovery (READ-ONLY MODE)\n')
  console.log('Querying Goldsky orderbook for all distinct traders...\n')

  const allWallets = new Set<string>()
  const walletTradeCount = new Map<string, number>()

  let skip = 0
  let totalProcessed = 0
  let hasMore = true
  let batchCount = 0

  const startTime = Date.now()

  while (hasMore) {
    try {
      batchCount++
      console.log(`Batch ${batchCount}: fetching events ${skip} to ${skip + BATCH_SIZE}...`)

      const data = await orderbookClient.request<{ orderFilledEvents: OrderEvent[] }>(
        GET_ALL_TRADERS,
        {
          limit: BATCH_SIZE,
          skip,
        }
      )

      const events = data.orderFilledEvents || []

      if (events.length === 0) {
        hasMore = false
        console.log('No more events found.')
        break
      }

      // Extract makers and takers
      for (const event of events) {
        const maker = event.maker.toLowerCase()
        const taker = event.taker.toLowerCase()

        allWallets.add(maker)
        allWallets.add(taker)

        walletTradeCount.set(maker, (walletTradeCount.get(maker) || 0) + 1)
        walletTradeCount.set(taker, (walletTradeCount.get(taker) || 0) + 1)
      }

      totalProcessed += events.length
      console.log(`  Found ${events.length} events, ${allWallets.size} unique wallets so far`)

      // Check if we got fewer than requested (last batch)
      if (events.length < BATCH_SIZE) {
        hasMore = false
        console.log('Reached end of data.')
        break
      }

      skip += BATCH_SIZE

      // Rate limiting
      await sleep(RATE_LIMIT_DELAY_MS)

      // Safety: Stop after 100k events for initial test
      // Remove this limit for full production run
      if (totalProcessed >= 100000) {
        console.log('\n⚠️  Reached 100k events limit (safety cap for initial run)')
        console.log('Remove this limit in production for full discovery')
        break
      }

    } catch (error) {
      console.error('Error fetching batch:', error)
      // Continue to next batch on error
      skip += BATCH_SIZE
      await sleep(1000) // Longer delay on error
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n✅ Discovery complete in ${elapsedSec}s`)
  console.log(`   Processed ${totalProcessed} order events`)
  console.log(`   Found ${allWallets.size} unique wallet addresses\n`)

  return { allWallets, walletTradeCount }
}

async function loadCurrentWallets(): Promise<Set<string>> {
  const currentWallets = new Set<string>()

  if (!fs.existsSync(CURRENT_WALLETS)) {
    console.log('⚠️  No current_wallets.jsonl found, assuming empty baseline')
    return currentWallets
  }

  const lines = fs.readFileSync(CURRENT_WALLETS, 'utf-8').trim().split('\n')
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.wallet_address) {
        currentWallets.add(obj.wallet_address.toLowerCase())
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  console.log(`📊 Loaded ${currentWallets.size} existing wallets from current_wallets.jsonl\n`)
  return currentWallets
}

async function main() {
  // Ensure runtime dir exists
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  }

  // Discover all traders from Goldsky
  const { allWallets, walletTradeCount } = await discoverAllTraders()

  // Load current wallets from ClickHouse export
  const currentWallets = await loadCurrentWallets()

  // Compute delta
  const newWallets = new Set<string>()
  for (const wallet of allWallets) {
    if (!currentWallets.has(wallet)) {
      newWallets.add(wallet)
    }
  }

  console.log('📊 Analysis:')
  console.log(`   Total discovered: ${allWallets.size}`)
  console.log(`   Already in system: ${currentWallets.size}`)
  console.log(`   NEW wallets: ${newWallets.size}`)
  console.log(`   Coverage: ${((currentWallets.size / allWallets.size) * 100).toFixed(2)}%\n`)

  // Get top 20 by trade count
  const sortedByTradeCount = Array.from(walletTradeCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  // Write outputs
  console.log('💾 Writing output files...\n')

  // 1. JSONL file (one address per line)
  const jsonlLines = Array.from(allWallets).map(addr => JSON.stringify({ wallet_address: addr }))
  fs.writeFileSync(OUTPUT_JSONL, jsonlLines.join('\n'))
  console.log(`   ✅ ${OUTPUT_JSONL}`)

  // 2. Stats file
  const stats = {
    discovery_timestamp: new Date().toISOString(),
    total_wallets_discovered: allWallets.size,
    current_wallets_in_system: currentWallets.size,
    new_wallets_found: newWallets.size,
    coverage_pct: ((currentWallets.size / allWallets.size) * 100).toFixed(2),
    total_events_processed: walletTradeCount.size,
    top_20_by_trade_count: sortedByTradeCount.map(([addr, count]) => ({
      wallet_address: addr,
      trade_count: count,
    })),
    note: 'This is a shadow discovery. NO ClickHouse writes performed.',
  }
  fs.writeFileSync(OUTPUT_STATS, JSON.stringify(stats, null, 2))
  console.log(`   ✅ ${OUTPUT_STATS}`)

  // 3. Sample file (10 random addresses)
  const sample = Array.from(allWallets).slice(0, 10).map(addr => ({ wallet_address: addr }))
  fs.writeFileSync(OUTPUT_SAMPLE, JSON.stringify(sample, null, 2))
  console.log(`   ✅ ${OUTPUT_SAMPLE}`)

  console.log('\n✅ Shadow discovery complete!')
  console.log('\n📋 Summary:')
  console.log(`   - Discovered ${allWallets.size} total wallets from Goldsky`)
  console.log(`   - ${newWallets.size} NEW wallets not in current system`)
  console.log(`   - Files written to runtime/shadow_wallet_universe.*`)
  console.log(`   - NO ClickHouse writes performed (safe parallel work)`)
  console.log('\nNext steps:')
  console.log('   1. Wait for Step D to complete')
  console.log('   2. Run Step E (resolution accuracy)')
  console.log('   3. Pass all 4 gates')
  console.log('   4. Bulk-apply shadow wallet backlog for Phase 2')
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { main }
