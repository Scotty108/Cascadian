#!/usr/bin/env tsx
/**
 * Discover Wallets from Goldsky (READ-ONLY)
 *
 * PURPOSE:
 * Query Goldsky P&L subgraph to discover ALL wallets with trading activity.
 * Filters by minimum volume/trades to focus on active traders.
 *
 * OUTPUT:
 * - runtime/discovered_wallets.jsonl (one wallet per line)
 * - runtime/discover-wallets.checkpoint.json (pagination state)
 *
 * FILTERS:
 * - minVolumeUSD >= 100 (configurable)
 * - minTrades >= 10 (configurable)
 *
 * USAGE:
 * npx tsx scripts/discover-wallets.ts
 * npx tsx scripts/discover-wallets.ts --min-volume=500 --min-trades=20
 * npx tsx scripts/discover-wallets.ts --resume
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { GraphQLClient } from 'graphql-request'

const GOLDSKY_PNL_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
const OUTPUT_FILE = resolve(process.cwd(), 'runtime/discovered_wallets.jsonl')
const CHECKPOINT_FILE = resolve(process.cwd(), 'runtime/discover-wallets.checkpoint.json')

const PAGE_SIZE = 1000
const MIN_VOLUME_USD = parseInt(process.env.MIN_VOLUME_USD || process.argv.find(a => a.startsWith('--min-volume='))?.split('=')[1] || '100')
const MIN_TRADES = parseInt(process.env.MIN_TRADES || process.argv.find(a => a.startsWith('--min-trades='))?.split('=')[1] || '10')
const RESUME = process.argv.includes('--resume')

interface DiscoveredWallet {
  wallet: string
  totalVolume: number
  numTrades: number
  totalPnL: number
}

interface Checkpoint {
  lastWallet: string
  totalDiscovered: number
  pageIndex: number
  timestamp: string
}

const client = new GraphQLClient(GOLDSKY_PNL_ENDPOINT)

// GraphQL query to get wallets with P&L data
const GET_WALLETS_QUERY = /* GraphQL */ `
  query GetWallets($lastWallet: String!, $limit: Int!, $minVolume: String!) {
    userPnLs(
      first: $limit
      where: {
        id_gt: $lastWallet
        totalVolume_gte: $minVolume
      }
      orderBy: id
      orderDirection: asc
    ) {
      id
      user
      totalPnL
      totalVolume
      numTrades
    }
  }
`

/**
 * Load checkpoint if resuming
 */
function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const content = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.warn('⚠️  Failed to load checkpoint:', error)
  }
  return null
}

/**
 * Save checkpoint
 */
function saveCheckpoint(checkpoint: Checkpoint) {
  try {
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
  } catch (error) {
    console.error('❌ Failed to save checkpoint:', error)
  }
}

/**
 * Append wallet to output file
 */
function appendWallet(wallet: DiscoveredWallet) {
  try {
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }
    fs.appendFileSync(OUTPUT_FILE, JSON.stringify(wallet) + '\n')
  } catch (error) {
    console.error('❌ Failed to append wallet:', error)
  }
}

/**
 * Fetch wallets from Goldsky with pagination
 */
async function discoverWallets() {
  console.log('🔍 Wallet Discovery Starting')
  console.log(`   Output: ${OUTPUT_FILE}`)
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log(`   Filters: minVolume >= $${MIN_VOLUME_USD}, minTrades >= ${MIN_TRADES}`)
  console.log('')

  let lastWallet = ''
  let pageIndex = 0
  let totalDiscovered = 0
  let totalFiltered = 0

  // Resume from checkpoint if requested
  if (RESUME) {
    const checkpoint = loadCheckpoint()
    if (checkpoint) {
      console.log(`🔄 Resuming from checkpoint`)
      console.log(`   Last wallet: ${checkpoint.lastWallet}`)
      console.log(`   Total discovered: ${checkpoint.totalDiscovered}`)
      console.log(`   Page: ${checkpoint.pageIndex}\n`)

      lastWallet = checkpoint.lastWallet
      pageIndex = checkpoint.pageIndex
      totalDiscovered = checkpoint.totalDiscovered
    } else {
      console.log('⚠️  No checkpoint found, starting fresh\n')
    }
  }

  // Paginate through all wallets
  let hasMore = true
  while (hasMore) {
    try {
      console.log(`   Fetching page ${pageIndex + 1} (after ${lastWallet || 'start'})...`)

      const response = await client.request(GET_WALLETS_QUERY, {
        lastWallet,
        limit: PAGE_SIZE,
        minVolume: MIN_VOLUME_USD.toString()
      })

      const userPnLs = response.userPnLs || []

      if (userPnLs.length === 0) {
        console.log('   ✅ No more results - discovery complete\n')
        hasMore = false
        break
      }

      console.log(`   Found ${userPnLs.length} wallets on this page`)

      // Filter and append wallets
      let pageFiltered = 0
      for (const pnl of userPnLs) {
        const numTrades = parseInt(pnl.numTrades)

        // Apply trade count filter
        if (numTrades >= MIN_TRADES) {
          const wallet: DiscoveredWallet = {
            wallet: pnl.user.toLowerCase(),
            totalVolume: parseFloat(pnl.totalVolume),
            numTrades: numTrades,
            totalPnL: parseFloat(pnl.totalPnL)
          }

          appendWallet(wallet)
          totalDiscovered++
        } else {
          pageFiltered++
        }

        lastWallet = pnl.id
      }

      totalFiltered += pageFiltered
      pageIndex++

      console.log(`   Added ${userPnLs.length - pageFiltered} wallets (filtered ${pageFiltered} with <${MIN_TRADES} trades)`)
      console.log(`   Total discovered so far: ${totalDiscovered}\n`)

      // Save checkpoint after each page
      saveCheckpoint({
        lastWallet,
        totalDiscovered,
        pageIndex,
        timestamp: new Date().toISOString()
      })

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100))

    } catch (error) {
      console.error(`❌ Error fetching page ${pageIndex}:`, error)

      // Save checkpoint before failing
      saveCheckpoint({
        lastWallet,
        totalDiscovered,
        pageIndex,
        timestamp: new Date().toISOString()
      })

      throw error
    }
  }

  // Final summary
  console.log('═══════════════════════════════════════════════════════════')
  console.log('✅ Wallet Discovery Complete')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`   Total discovered: ${totalDiscovered}`)
  console.log(`   Total filtered out: ${totalFiltered}`)
  console.log(`   Pages processed: ${pageIndex}`)
  console.log(`   Output file: ${OUTPUT_FILE}`)
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Summary stats
  if (fs.existsSync(OUTPUT_FILE)) {
    const stats = fs.statSync(OUTPUT_FILE)
    const lines = fs.readFileSync(OUTPUT_FILE, 'utf-8').split('\n').filter(Boolean).length
    console.log(`📊 Output file stats:`)
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
    console.log(`   Lines: ${lines.toLocaleString()}`)
    console.log('')
  }

  return {
    totalDiscovered,
    totalFiltered,
    outputFile: OUTPUT_FILE
  }
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  discoverWallets().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}

export { discoverWallets }
