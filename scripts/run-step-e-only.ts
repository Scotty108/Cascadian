#!/usr/bin/env tsx
/**
 * Step E Only: Recompute Resolution Outcomes for ALL Wallets
 *
 * PURPOSE:
 * Rebuild wallet_resolution_outcomes table after Step D (P&L calculation) is complete.
 * This computes resolution accuracy / conviction accuracy for every wallet.
 *
 * WHAT IT DOES:
 * 1. Truncate wallet_resolution_outcomes table
 * 2. For each wallet:
 *    - Get all resolved positions
 *    - Calculate net position per market (final_side: YES or NO)
 *    - Determine if they won (final_side === resolved_outcome)
 *    - Insert resolution outcomes
 * 3. Calculate global resolution accuracy metrics
 *
 * EXPECTED TIME:
 * - 2,839 wallets: ~35 minutes (current run)
 * - 65,000 wallets: ~2-3 hours (with batch inserts)
 *
 * OPTIMIZATIONS:
 * 1. Pre-loads all categories via correct JOIN (markets_dim → events_dim)
 * 2. Batch inserts (1000 outcomes at a time) - 10x faster than individual inserts
 *
 * USAGE:
 * npx tsx scripts/run-step-e-only.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const RESOLUTION_MAP_FILE = resolve(process.cwd(), 'data/expanded_resolution_map.json')

interface Resolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: number
  payout_no: number
  resolved_at: string | null
}

interface ResolutionMapFile {
  total_conditions: number
  resolved_conditions: number
  last_updated: string
  resolutions: Resolution[]
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('       Step E: Recompute Resolution Outcomes              ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log('This computes resolution accuracy (conviction accuracy) for every wallet.\n')

  // Load resolution map
  console.log('📄 Loading resolution map...')
  if (!fs.existsSync(RESOLUTION_MAP_FILE)) {
    throw new Error('Resolution map not found. Run Step C first.')
  }

  const content = fs.readFileSync(RESOLUTION_MAP_FILE, 'utf-8')
  const resolutionMap: ResolutionMapFile = JSON.parse(content)

  const resolutionsByCondition = new Map<string, Resolution>()
  const resolutionsByMarket = new Map<string, Resolution>()

  for (const res of resolutionMap.resolutions) {
    if (res.condition_id) {
      resolutionsByCondition.set(res.condition_id, res)
    }
    resolutionsByMarket.set(res.market_id, res)
  }

  console.log(`   ✅ Loaded ${resolutionsByCondition.size} resolutions by condition_id`)
  console.log(`   ✅ Loaded ${resolutionsByMarket.size} resolutions by market_id\n`)

  // Load category mappings (OPTIMIZED: Load once, not per wallet!)
  console.log('🏷️  Loading category mappings...')
  const categoryMap = new Map<string, string>()
  try {
    const categoryResult = await clickhouse.query({
      query: `
        SELECT
          m.market_id,
          e.canonical_category
        FROM markets_dim m
        LEFT JOIN events_dim e ON m.event_id = e.event_id
      `,
      format: 'JSONEachRow',
    })
    const categoryData = await categoryResult.json<{ market_id: string, canonical_category: string }>()
    for (const row of categoryData) {
      if (row.market_id && row.canonical_category) {
        categoryMap.set(row.market_id, row.canonical_category)
      }
    }
    console.log(`   ✅ Loaded ${categoryMap.size} market → category mappings\n`)
  } catch (error) {
    console.warn(`   ⚠️  Failed to load categories: ${error instanceof Error ? error.message : error}`)
    console.log(`   Continuing with empty category map...\n`)
  }

  // Truncate wallet_resolution_outcomes
  console.log('🗑️  Truncating wallet_resolution_outcomes...')
  await clickhouse.command({
    query: `TRUNCATE TABLE wallet_resolution_outcomes`,
  })
  console.log('   ✅ Table truncated\n')

  // Get all distinct wallet addresses
  console.log('👥 Querying distinct wallets...')
  const walletsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet_address FROM trades_raw ORDER BY wallet_address`,
    format: 'JSONEachRow',
  })

  const wallets = await walletsResult.json<{ wallet_address: string }>()
  console.log(`   ✅ Found ${wallets.length} distinct wallets\n`)

  let totalOutcomesInserted = 0
  let walletsProcessed = 0

  const startTime = Date.now()

  console.log('🔄 Processing wallets...\n')

  // OPTIMIZATION: Batch insert configuration
  const BATCH_SIZE = 1000
  const outcomesBatch: any[] = []

  async function flushBatch() {
    if (outcomesBatch.length === 0) return

    await clickhouse.insert({
      table: 'wallet_resolution_outcomes',
      values: outcomesBatch,
      format: 'JSONEachRow',
    })

    totalOutcomesInserted += outcomesBatch.length
    outcomesBatch.length = 0 // Clear the batch
  }

  // Process each wallet
  for (const { wallet_address } of wallets) {
    try {
      // Get all resolved positions for this wallet
      const positionsResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            market_id,
            side,
            SUM(shares) as total_shares,
            COUNT(*) as num_trades
          FROM trades_raw
          WHERE wallet_address = '${wallet_address}' AND is_resolved = 1
          GROUP BY condition_id, market_id, side
        `,
        format: 'JSONEachRow',
      })

      const positions = await positionsResult.json<{
        condition_id: string,
        market_id: string,
        side: 'YES' | 'NO',
        total_shares: number,
        num_trades: number
      }>()

      // Group by condition_id to calculate net position
      const netPositions = new Map<string, {
        condition_id: string,
        market_id: string,
        net_shares: number,
        num_trades: number
      }>()

      for (const pos of positions) {
        const key = pos.condition_id
        if (!netPositions.has(key)) {
          netPositions.set(key, {
            condition_id: pos.condition_id,
            market_id: pos.market_id,
            net_shares: 0,
            num_trades: 0
          })
        }

        const net = netPositions.get(key)!
        if (pos.side === 'YES') {
          net.net_shares += pos.total_shares
        } else {
          net.net_shares -= pos.total_shares
        }
        net.num_trades += pos.num_trades
      }

      // Process each net position
      for (const net of Array.from(netPositions.values())) {
        // Skip if position is essentially flat
        if (Math.abs(net.net_shares) < 0.01) continue

        // Determine final side
        const finalSide = net.net_shares > 0 ? 'YES' : 'NO'

        // Look up resolution
        const resolution = resolutionsByCondition.get(net.condition_id) || resolutionsByMarket.get(net.market_id)

        if (!resolution) continue

        // Determine if won
        const won = finalSide === resolution.resolved_outcome ? 1 : 0

        // Get canonical category from pre-loaded map (FAST!)
        const canonicalCategory = categoryMap.get(net.market_id) || 'Unknown'

        // Add to batch instead of inserting individually
        outcomesBatch.push({
          wallet_address,
          condition_id: net.condition_id,
          market_id: net.market_id,
          resolved_outcome: resolution.resolved_outcome,
          final_side: finalSide,
          won,
          resolved_at: resolution.resolved_at || new Date().toISOString(),
          canonical_category: canonicalCategory,
          num_trades: net.num_trades,
          final_shares: Math.abs(net.net_shares),
          ingested_at: new Date().toISOString()
        })

        // Flush batch when it reaches size limit
        if (outcomesBatch.length >= BATCH_SIZE) {
          await flushBatch()
        }
      }

      walletsProcessed++

      if (walletsProcessed % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
        const pendingInBatch = outcomesBatch.length
        console.log(`   Progress: ${walletsProcessed}/${wallets.length} wallets (${totalOutcomesInserted + pendingInBatch} outcomes, ${pendingInBatch} pending) - ${elapsed} min`)
      }

    } catch (error) {
      console.warn(`   ❌ Error processing wallet ${wallet_address}:`, error instanceof Error ? error.message : error)
    }
  }

  // Flush any remaining outcomes in the batch
  console.log(`\n   💾 Flushing final batch (${outcomesBatch.length} outcomes)...`)
  await flushBatch()

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log(`\n   ✅ Processed ${walletsProcessed} wallets in ${totalDuration} minutes\n`)

  // Calculate global metrics
  console.log('📊 Calculating global metrics...')
  const globalResult = await clickhouse.query({
    query: `
      SELECT
        AVG(won) * 100 as accuracy_pct,
        COUNT(DISTINCT condition_id) as resolution_markets
      FROM wallet_resolution_outcomes
    `,
    format: 'JSONEachRow',
  })

  const globalData = await globalResult.json<{ accuracy_pct: number, resolution_markets: string }>()
  const globalAccuracy = globalData[0]?.accuracy_pct || 0
  const resolutionMarkets = parseInt(globalData[0]?.resolution_markets || '0')

  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('✅ STEP E COMPLETE!')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`   Total time: ${totalDuration} minutes`)
  console.log(`   Wallets processed: ${walletsProcessed.toLocaleString()}`)
  console.log(`   Outcomes inserted: ${totalOutcomesInserted.toLocaleString()}`)
  console.log(`   Global resolution accuracy: ${globalAccuracy.toFixed(2)}%`)
  console.log(`   Resolution markets tracked: ${resolutionMarkets}`)
  console.log('═══════════════════════════════════════════════════════════')
  console.log('\n📊 Next: Gates validation will run automatically')
  console.log('   (Auto-continue pipeline is monitoring for completion)')
  console.log('')
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}

export { main }
