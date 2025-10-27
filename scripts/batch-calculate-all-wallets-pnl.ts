#!/usr/bin/env npx tsx
/**
 * BATCH AUDITED P&L CALCULATION - ALL WALLETS
 *
 * Scales the audited P&L engine to all wallets in ClickHouse
 * Enforces same invariants as calculate-audited-wallet-pnl.ts:
 * - Shares ÷ 128 correction
 * - Binary resolution validation ([1,0] or [0,1])
 * - Coverage >= 2% filter
 *
 * Output: audited_wallet_pnl_extended.json
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const SHARES_CORRECTION_FACTOR = 128
const MINIMUM_COVERAGE_PCT = 2.0
const API_DELAY_MS = 1200

interface Fill {
  condition_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
}

interface ConditionResolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: number | null
  payout_no: number | null
  resolved_at: string | null
}

interface WalletPnL {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
}

/**
 * Fetch market resolution from Polymarket API
 */
async function fetchMarketResolution(marketId: string): Promise<{ resolved_outcome: 'YES' | 'NO' | null }> {
  try {
    const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`)
    if (!response.ok) return { resolved_outcome: null }

    const data = await response.json()
    if (data.closed !== true) return { resolved_outcome: null }

    const outcomePrices = JSON.parse(data.outcomePrices) as number[]
    if (!Array.isArray(outcomePrices) || outcomePrices.length !== 2) {
      return { resolved_outcome: null }
    }

    const price0 = Number(outcomePrices[0])
    const price1 = Number(outcomePrices[1])

    if (isNaN(price0) || isNaN(price1)) return { resolved_outcome: null }

    if (price0 === 1 && price1 === 0) return { resolved_outcome: 'YES' }
    if (price0 === 0 && price1 === 1) return { resolved_outcome: 'NO' }

    return { resolved_outcome: null }
  } catch {
    return { resolved_outcome: null }
  }
}

/**
 * Calculate P&L for a single condition
 */
function calculateConditionPnL(fills: Fill[], resolved_outcome: 'YES' | 'NO'): number {
  let yes_shares = 0, yes_cost = 0, no_shares = 0, no_cost = 0

  for (const fill of fills) {
    if (isNaN(fill.shares) || fill.shares < 0) continue
    const corrected_shares = fill.shares / SHARES_CORRECTION_FACTOR

    if (fill.side === 'YES') {
      yes_shares += corrected_shares
      yes_cost += fill.entry_price * corrected_shares
    } else {
      no_shares += corrected_shares
      no_cost += fill.entry_price * corrected_shares
    }
  }

  const payout = resolved_outcome === 'YES' ? yes_shares : no_shares
  return payout - (yes_cost + no_cost)
}

async function main() {
  console.log('🏦 BATCH AUDITED P&L CALCULATION - ALL WALLETS\n')
  console.log('================================================\n')

  // Step 1: Get all wallet addresses
  console.log('📊 Step 1: Fetching all wallet addresses...\n')

  const walletsQuery = `SELECT DISTINCT wallet_address FROM trades_raw ORDER BY wallet_address`
  const walletsResult = await clickhouse.query({ query: walletsQuery, format: 'JSONEachRow' })
  const wallets = await walletsResult.json<{ wallet_address: string }>()

  console.log(`✅ Found ${wallets.length} unique wallets\n`)

  // Step 2: Load resolution map
  console.log('📊 Step 2: Loading resolution map...\n')

  const dataDir = resolve(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  const resolutionMapPath = resolve(dataDir, 'expanded_resolution_map.json')
  let resolutionMap = new Map<string, ConditionResolution>()

  if (fs.existsSync(resolutionMapPath)) {
    const mapData = JSON.parse(fs.readFileSync(resolutionMapPath, 'utf-8'))
    for (const res of mapData.resolutions || []) {
      resolutionMap.set(res.condition_id, res)
    }
    console.log(`✅ Loaded ${resolutionMap.size} resolutions\n`)
  }

  // Step 3: Expand resolution map for all conditions
  console.log('📊 Step 3: Expanding resolution coverage for all conditions...\n')

  const allConditionsQuery = `
    SELECT DISTINCT condition_id, market_id
    FROM trades_raw
    WHERE market_id != '' AND market_id != 'unknown'
    ORDER BY condition_id
  `
  const conditionsResult = await clickhouse.query({ query: allConditionsQuery, format: 'JSONEachRow' })
  const allConditions = await conditionsResult.json<{ condition_id: string; market_id: string }>()

  console.log(`✅ Found ${allConditions.length} unique conditions with market_ids\n`)

  const newConditions = allConditions.filter(c => !resolutionMap.has(c.condition_id))
  console.log(`🔄 Need to fetch ${newConditions.length} new resolutions\n`)

  if (newConditions.length > 0) {
    const NUM_WORKERS = 5
    console.log('🌐 Fetching resolutions from Polymarket API...')
    console.log(`   Using ${NUM_WORKERS} parallel workers (AGGRESSIVE MODE)`)
    console.log(`   (This will take ~${Math.ceil(newConditions.length * API_DELAY_MS / 60000 / NUM_WORKERS)} minutes)\n`)

    let fetched = 0
    let resolved = 0
    const progressLock = { value: 0 }
    const initialResolutionCount = resolutionMap.size

    // Split conditions into chunks for workers
    const chunkSize = Math.ceil(newConditions.length / NUM_WORKERS)
    const chunks = []
    for (let i = 0; i < NUM_WORKERS; i++) {
      chunks.push(newConditions.slice(i * chunkSize, (i + 1) * chunkSize))
    }

    // Worker function
    async function worker(conditions: typeof newConditions, workerId: number) {
      for (const condition of conditions) {
        progressLock.value++
        const currentFetched = progressLock.value

        if (currentFetched % 50 === 0) {
          const newResolved = resolutionMap.size - initialResolutionCount
          console.log(`   Progress: ${currentFetched}/${newConditions.length} (${newResolved} resolved)`)
        }

        const { resolved_outcome } = await fetchMarketResolution(condition.market_id)

        if (resolved_outcome) {
          resolutionMap.set(condition.condition_id, {
            condition_id: condition.condition_id,
            market_id: condition.market_id,
            resolved_outcome,
            payout_yes: resolved_outcome === 'YES' ? 1 : 0,
            payout_no: resolved_outcome === 'NO' ? 1 : 0,
            resolved_at: new Date().toISOString()
          })
        }

        // INCREMENTAL SAVE: Save every 500 resolutions to prevent data loss
        if (currentFetched % 500 === 0) {
          const mapData = {
            total_conditions: allConditions.length,
            resolved_conditions: resolutionMap.size,
            last_updated: new Date().toISOString(),
            resolutions: Array.from(resolutionMap.values())
          }
          fs.writeFileSync(resolutionMapPath, JSON.stringify(mapData, null, 2))
          console.log(`   💾 Checkpoint saved: ${resolutionMap.size} resolutions`)
        }

        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS))
      }
    }

    // Run workers in parallel
    await Promise.all(chunks.map((chunk, i) => worker(chunk, i)))

    const newResolved = resolutionMap.size - 1830
    console.log(`\n✅ Fetched ${newResolved} new resolutions`)

    // Save updated resolution map
    const mapData = {
      total_conditions: allConditions.length,
      resolved_conditions: resolutionMap.size,
      last_updated: new Date().toISOString(),
      resolutions: Array.from(resolutionMap.values())
    }
    fs.writeFileSync(resolutionMapPath, JSON.stringify(mapData, null, 2))
    console.log(`✅ Updated ${resolutionMapPath}\n`)
  }

  // Step 4: Calculate P&L for all wallets
  console.log('📊 Step 4: Calculating P&L for all wallets...\n')

  const results: WalletPnL[] = []
  let processed = 0

  for (const { wallet_address } of wallets) {
    processed++

    if (processed % 100 === 0) {
      console.log(`   Progress: ${processed}/${wallets.length} wallets`)
    }

    // Get all conditions for this wallet
    const conditionsQuery = `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE wallet_address = '${wallet_address}'
    `
    const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' })
    const conditions = await conditionsResult.json<{ condition_id: string }>()

    let totalPnL = 0
    let coveredCount = 0

    // Calculate P&L for each resolved condition
    for (const { condition_id } of conditions) {
      const resolution = resolutionMap.get(condition_id)
      if (!resolution || !resolution.resolved_outcome) continue

      const fillsQuery = `
        SELECT condition_id, side, entry_price, shares
        FROM trades_raw
        WHERE wallet_address = '${wallet_address}' AND condition_id = '${condition_id}'
      `
      const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' })
      const fills = await fillsResult.json<Fill>()

      totalPnL += calculateConditionPnL(fills, resolution.resolved_outcome)
      coveredCount++
    }

    const coverage_pct = conditions.length > 0 ? (coveredCount / conditions.length) * 100 : 0

    // Only include if coverage >= 2%
    if (coverage_pct >= MINIMUM_COVERAGE_PCT) {
      results.push({
        wallet_address,
        realized_pnl_usd: parseFloat(totalPnL.toFixed(2)),
        coverage_pct: parseFloat(coverage_pct.toFixed(2))
      })
    }
  }

  console.log(`\n✅ Processed ${wallets.length} wallets`)
  console.log(`✅ Qualified wallets (coverage >= ${MINIMUM_COVERAGE_PCT}%): ${results.length}\n`)

  // Step 5: Sort by P&L descending and write output
  console.log('📊 Step 5: Writing results...\n')

  results.sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)

  // Write to data/ directory (source of truth)
  // dataDir already defined at top of function
  const sourcePath = resolve(dataDir, 'audited_wallet_pnl_extended.json')
  fs.writeFileSync(sourcePath, JSON.stringify(results, null, 2))

  // Copy to lib/data/ for runtime import
  const runtimePath = resolve(process.cwd(), 'lib/data/audited_wallet_pnl_extended.json')
  fs.writeFileSync(runtimePath, JSON.stringify(results, null, 2))

  console.log(`✅ Wrote source of truth: ${sourcePath}`)
  console.log(`✅ Copied to runtime: ${runtimePath}`)
  console.log(`   Total wallets: ${results.length}`)
  console.log(`   Total P&L: $${results.reduce((sum, w) => sum + w.realized_pnl_usd, 0).toLocaleString()}\n`)

  console.log('================================================')
  console.log('✅ BATCH CALCULATION COMPLETE')
  console.log('================================================\n')

  // Show top 10
  console.log('📊 Top 10 Wallets by Realized P&L:\n')
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const w = results[i]
    console.log(`${i + 1}. ${w.wallet_address.slice(0, 10)}... - $${w.realized_pnl_usd.toLocaleString()} (${w.coverage_pct}% coverage)`)
  }
  console.log()

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
