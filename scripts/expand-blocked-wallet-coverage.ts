/**
 * EXPAND RESOLUTION COVERAGE FOR BLOCKED WALLETS
 *
 * Purpose: Fetch missing condition resolutions for wallets with 0% coverage
 *
 * Target Wallets:
 * - 0xe27b3674cfccb0cc87426d421ee3faaceb9168d2 (181 condition_ids, 0 resolved)
 * - 0xd199709b1e8cc374cf1d6100f074f15fc04ea5f2 (111 condition_ids, 0 resolved)
 *
 * Process:
 * 1. Extract all condition_ids for blocked wallets from ClickHouse
 * 2. Load existing expanded_resolution_map.json
 * 3. Identify missing resolutions
 * 4. Fetch from Polymarket API with rate limiting
 * 5. Merge and save updated resolution map
 * 6. Re-calculate P&L for all 5 wallets
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const BLOCKED_WALLETS = [
  '0xe27b3674cfccb0cc87426d421ee3faaceb9168d2',
  '0xd199709b1e8cc374cf1d6100f074f15fc04ea5f2'
]

const ALL_WALLETS = [
  '0xc7f7edb333f5cbd8a3146805e21602984b852abf',
  '0x3a03c6dd168a7a24864c4df17bf4dd06be09a0b7',
  '0xb744f56635b537e859152d14b022af5afe485210',
  '0xe27b3674cfccb0cc87426d421ee3faaceb9168d2',
  '0xd199709b1e8cc374cf1d6100f074f15fc04ea5f2'
]

const API_DELAY_MS = 1200  // 50 requests per minute
const SHARES_CORRECTION_FACTOR = 128

interface ConditionData {
  condition_id: string
  market_id: string
}

interface ConditionResolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: number | null
  payout_no: number | null
  resolved_at: string | null
}

interface Fill {
  condition_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  timestamp: string
}

interface WalletPnL {
  wallet: string
  realized_pnl_usd: number
  resolved_conditions_covered: number
  total_conditions_seen: number
  coverage_pct: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * STEP 1: Extract condition IDs for blocked wallets
 */
async function extractBlockedWalletConditions(): Promise<Map<string, ConditionData[]>> {
  console.log('📊 STEP 1: Extracting condition IDs for blocked wallets\n')
  console.log('================================================\n')

  const walletConditions = new Map<string, ConditionData[]>()

  for (const wallet of BLOCKED_WALLETS) {
    console.log(`🔍 Querying conditions for ${wallet.slice(0, 10)}...`)

    const query = `
      SELECT DISTINCT
        condition_id,
        market_id
      FROM trades_raw
      WHERE wallet_address = '${wallet}'
        AND market_id != 'unknown'
        AND market_id != ''
      ORDER BY condition_id
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const conditions = await result.json<ConditionData>()
    walletConditions.set(wallet, conditions)

    console.log(`   Found ${conditions.length} unique conditions with market_ids`)
  }

  // Save to debug file
  const debugData: Record<string, ConditionData[]> = {}
  for (const [wallet, conditions] of walletConditions) {
    debugData[wallet] = conditions
  }

  const debugPath = resolve(process.cwd(), 'blocked_wallets_conditions.json')
  fs.writeFileSync(debugPath, JSON.stringify(debugData, null, 2))
  console.log(`\n✅ Saved blocked_wallets_conditions.json`)

  return walletConditions
}

/**
 * STEP 2: Load existing resolution map
 */
function loadExistingResolutionMap(): Map<string, ConditionResolution> {
  console.log('\n📊 STEP 2: Loading existing resolution map\n')
  console.log('================================================\n')

  const mapPath = resolve(process.cwd(), 'expanded_resolution_map.json')

  if (!fs.existsSync(mapPath)) {
    console.log('⚠️  No existing resolution map found, starting fresh')
    return new Map()
  }

  const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'))
  const resolutions = mapData.resolutions || []

  const resolutionMap = new Map<string, ConditionResolution>()
  for (const resolution of resolutions) {
    resolutionMap.set(resolution.condition_id, resolution)
  }

  console.log(`✅ Loaded ${resolutionMap.size} existing resolutions`)

  return resolutionMap
}

/**
 * STEP 3: Fetch missing resolutions from Polymarket API
 */
async function fetchMissingResolutions(
  walletConditions: Map<string, ConditionData[]>,
  existingMap: Map<string, ConditionResolution>
): Promise<Map<string, ConditionResolution>> {
  console.log('\n📊 STEP 3: Fetching missing resolutions from Polymarket API\n')
  console.log('================================================\n')

  // Collect all unique conditions across blocked wallets
  const allConditions = new Map<string, ConditionData>()
  for (const [wallet, conditions] of walletConditions) {
    for (const condition of conditions) {
      allConditions.set(condition.condition_id, condition)
    }
  }

  console.log(`Total unique conditions across blocked wallets: ${allConditions.size}`)

  // Find conditions that need resolution data
  const missingConditions: ConditionData[] = []
  for (const [conditionId, conditionData] of allConditions) {
    const existing = existingMap.get(conditionId)
    if (!existing || existing.resolved_outcome === null) {
      missingConditions.push(conditionData)
    }
  }

  console.log(`Conditions needing resolution: ${missingConditions.length}\n`)

  if (missingConditions.length === 0) {
    console.log('✅ No missing resolutions to fetch')
    return existingMap
  }

  // Estimate time
  const estimatedMinutes = Math.ceil((missingConditions.length * API_DELAY_MS) / 60000)
  console.log(`⏱️  Estimated time: ~${estimatedMinutes} minutes`)
  console.log(`⚙️  Rate limit: 50 requests/min (${API_DELAY_MS}ms delay)\n`)

  let fetched = 0
  let resolved = 0
  let failed = 0

  for (const condition of missingConditions) {
    fetched++

    if (fetched % 25 === 0 || fetched === 1) {
      console.log(`   Progress: ${fetched}/${missingConditions.length} (${resolved} resolved, ${failed} failed)`)
    }

    try {
      const response = await fetch(`https://gamma-api.polymarket.com/markets/${condition.market_id}`)

      if (!response.ok) {
        failed++
        continue
      }

      const data = await response.json()
      const isClosed = data.closed === true

      if (!isClosed) {
        continue
      }

      const prices = typeof data.outcomePrices === 'string'
        ? JSON.parse(data.outcomePrices)
        : data.outcomePrices

      let resolved_outcome: 'YES' | 'NO' | null = null
      if (prices[0] === '1' || prices[0] === 1) {
        resolved_outcome = 'YES'
      } else if (prices[1] === '1' || prices[1] === 1) {
        resolved_outcome = 'NO'
      }

      if (resolved_outcome) {
        resolved++
        existingMap.set(condition.condition_id, {
          condition_id: condition.condition_id,
          market_id: condition.market_id,
          resolved_outcome,
          payout_yes: resolved_outcome === 'YES' ? 1 : 0,
          payout_no: resolved_outcome === 'NO' ? 1 : 0,
          resolved_at: data.resolvedAt || new Date().toISOString()
        })
      }
    } catch (error) {
      failed++
      if (fetched % 25 === 0) {
        console.log(`      ⚠️  Error fetching market ${condition.market_id}: ${error instanceof Error ? error.message : 'Unknown'}`)
      }
    }

    // Rate limiting
    await sleep(API_DELAY_MS)
  }

  console.log(`\n✅ Fetching complete:`)
  console.log(`   Total fetched: ${fetched}`)
  console.log(`   New resolutions: ${resolved}`)
  console.log(`   Failed/unresolved: ${failed}`)

  return existingMap
}

/**
 * STEP 4: Merge and save resolution map
 */
function saveResolutionMap(resolutionMap: Map<string, ConditionResolution>): void {
  console.log('\n📊 STEP 4: Saving updated resolution map\n')
  console.log('================================================\n')

  const resolutions = Array.from(resolutionMap.values())
  const resolvedCount = resolutions.filter(r => r.resolved_outcome !== null).length

  const mapData = {
    total_conditions: resolutions.length,
    resolved_conditions: resolvedCount,
    last_updated: new Date().toISOString(),
    resolutions
  }

  const mapPath = resolve(process.cwd(), 'expanded_resolution_map.json')
  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2))

  console.log(`✅ Saved expanded_resolution_map.json`)
  console.log(`   Total conditions: ${resolutions.length}`)
  console.log(`   Resolved conditions: ${resolvedCount} (${((resolvedCount / resolutions.length) * 100).toFixed(1)}%)`)
}

/**
 * Calculate realized P&L for a single condition
 */
function calculateConditionPnL(fills: Fill[], resolved_outcome: 'YES' | 'NO'): number {
  let yes_shares = 0
  let yes_cost = 0
  let no_shares = 0
  let no_cost = 0

  for (const fill of fills) {
    const corrected_shares = fill.shares / SHARES_CORRECTION_FACTOR

    if (fill.side === 'YES') {
      yes_shares += corrected_shares
      yes_cost += fill.entry_price * corrected_shares
    } else {
      no_shares += corrected_shares
      no_cost += fill.entry_price * corrected_shares
    }
  }

  const total_cost = yes_cost + no_cost

  let payout = 0
  if (resolved_outcome === 'YES') {
    payout = yes_shares
  } else if (resolved_outcome === 'NO') {
    payout = no_shares
  }

  return payout - total_cost
}

/**
 * Calculate total realized P&L for a wallet
 */
async function calculateWalletPnL(
  walletAddress: string,
  resolutionMap: Map<string, ConditionResolution>
): Promise<WalletPnL> {
  // Get all unique condition_ids for this wallet
  const conditionsQuery = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
    ORDER BY condition_id
  `

  const result = await clickhouse.query({
    query: conditionsQuery,
    format: 'JSONEachRow',
  })

  const allConditions = await result.json<{ condition_id: string }>()
  const totalConditions = allConditions.length

  // Process each condition with resolution data
  let totalPnL = 0
  let coveredCount = 0

  for (const { condition_id } of allConditions) {
    const resolution = resolutionMap.get(condition_id)

    if (!resolution || !resolution.resolved_outcome) {
      continue
    }

    // Get fills for this condition
    const fillsQuery = `
      SELECT condition_id, side, entry_price, shares, timestamp
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND condition_id = '${condition_id}'
      ORDER BY timestamp ASC
    `

    const fillsResult = await clickhouse.query({
      query: fillsQuery,
      format: 'JSONEachRow',
    })

    const fills = await fillsResult.json<Fill>()

    // Calculate P&L for this condition
    const conditionPnL = calculateConditionPnL(fills, resolution.resolved_outcome)

    totalPnL += conditionPnL
    coveredCount++
  }

  const coveragePct = totalConditions > 0 ? (coveredCount / totalConditions) * 100 : 0

  return {
    wallet: walletAddress,
    realized_pnl_usd: parseFloat(totalPnL.toFixed(2)),
    resolved_conditions_covered: coveredCount,
    total_conditions_seen: totalConditions,
    coverage_pct: parseFloat(coveragePct.toFixed(2))
  }
}

/**
 * STEP 5: Regenerate audited P&L for all 5 wallets
 */
async function regenerateAuditedPnL(resolutionMap: Map<string, ConditionResolution>): Promise<void> {
  console.log('\n📊 STEP 5: Regenerating audited P&L for all 5 wallets\n')
  console.log('================================================\n')

  const results: WalletPnL[] = []

  for (const wallet of ALL_WALLETS) {
    console.log(`💰 Calculating P&L for ${wallet.slice(0, 10)}...`)
    const pnl = await calculateWalletPnL(wallet, resolutionMap)
    results.push(pnl)

    console.log(`   Coverage: ${pnl.coverage_pct}% (${pnl.resolved_conditions_covered}/${pnl.total_conditions_seen})`)
    console.log(`   P&L: $${pnl.realized_pnl_usd.toLocaleString()}`)
  }

  // Save results
  const outputPath = resolve(process.cwd(), 'audited_wallet_pnl.json')
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))

  console.log(`\n✅ Saved audited_wallet_pnl.json`)
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 EXPAND RESOLUTION COVERAGE FOR BLOCKED WALLETS\n')
  console.log('================================================\n')
  console.log('Target wallets:')
  for (const wallet of BLOCKED_WALLETS) {
    console.log(`  - ${wallet}`)
  }
  console.log('\n================================================\n')

  // Step 1: Extract condition IDs
  const walletConditions = await extractBlockedWalletConditions()

  // Step 2: Load existing resolution map
  const resolutionMap = loadExistingResolutionMap()

  const beforeResolvedCount = Array.from(resolutionMap.values())
    .filter(r => r.resolved_outcome !== null).length

  // Step 3: Fetch missing resolutions
  const updatedMap = await fetchMissingResolutions(walletConditions, resolutionMap)

  const afterResolvedCount = Array.from(updatedMap.values())
    .filter(r => r.resolved_outcome !== null).length

  const newResolutionsAdded = afterResolvedCount - beforeResolvedCount

  // Step 4: Save updated map
  saveResolutionMap(updatedMap)

  // Step 5: Regenerate P&L for all wallets
  await regenerateAuditedPnL(updatedMap)

  // Final summary
  console.log('\n================================================')
  console.log('📊 FINAL SUMMARY')
  console.log('================================================\n')

  console.log(`✅ New resolutions added: ${newResolutionsAdded}`)
  console.log(`✅ Total resolutions in map: ${afterResolvedCount}`)
  console.log(`✅ Coverage expanded for blocked wallets\n`)

  console.log('Output files:')
  console.log('  1. expanded_resolution_map.json - Updated resolution map')
  console.log('  2. audited_wallet_pnl.json - Updated P&L for all 5 wallets')
  console.log('  3. blocked_wallets_conditions.json - Debug file with condition IDs')

  console.log('\n================================================')
  console.log('✅ Complete!')
  console.log('================================================\n')

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
