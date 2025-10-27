#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import { writeFileSync } from 'fs'
import { fetchWalletPnL } from '../lib/goldsky/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const WALLET_ADDRESS = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
const GROUND_TRUTH_PNL = 2650.64

interface Trade {
  condition_id: string
  market_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  timestamp: string
}

interface ResolutionData {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO' | null
  payout_yes: number | null
  payout_no: number | null
  resolved_at: string | null
  error?: string
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// STEP 1: Extract condition_ids for wallet
// ============================================================================

async function extractConditionIds(): Promise<string[]> {
  console.log('═'.repeat(80))
  console.log('STEP 1: Extracting condition_ids for wallet')
  console.log('═'.repeat(80))

  const query = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE wallet_address = '${WALLET_ADDRESS}'
    ORDER BY condition_id
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data: Array<{ condition_id: string }> = await result.json()
  const conditionIds = data.map((row) => row.condition_id)

  console.log(`Found ${conditionIds.length} distinct condition_ids`)

  // Write to JSON
  writeFileSync(
    'wallet_condition_ids.json',
    JSON.stringify(
      {
        wallet: WALLET_ADDRESS,
        condition_count: conditionIds.length,
        condition_ids: conditionIds,
      },
      null,
      2
    )
  )

  console.log('✓ Wrote wallet_condition_ids.json\n')

  return conditionIds
}

// ============================================================================
// STEP 2: Fetch resolution data from Polymarket API
// ============================================================================

async function fetchMarketResolution(marketId: string): Promise<any> {
  const url = `https://gamma-api.polymarket.com/markets/${marketId}`

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error(`Failed to fetch market ${marketId}:`, error)
    return null
  }
}

async function buildResolutionMap(conditionIds: string[]): Promise<Map<string, ResolutionData>> {
  console.log('═'.repeat(80))
  console.log('STEP 2: Fetching resolution data from Polymarket')
  console.log('═'.repeat(80))

  // First, get all trades with their market_ids
  const query = `
    SELECT DISTINCT
      condition_id,
      market_id
    FROM trades_raw
    WHERE wallet_address = '${WALLET_ADDRESS}'
      AND market_id != 'unknown'
      AND market_id != ''
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const marketMappings: Array<{ condition_id: string; market_id: string }> = await result.json()

  console.log(
    `Found ${marketMappings.length} condition_ids with known market_ids (out of ${conditionIds.length} total)`
  )

  const resolutionMap = new Map<string, ResolutionData>()

  // Fetch resolution for each market
  let fetched = 0
  let resolved = 0
  let errors = 0

  for (const mapping of marketMappings) {
    const { condition_id, market_id } = mapping

    // Rate limit: 50 requests per minute = ~1.2 second intervals
    await sleep(1200)

    const marketData = await fetchMarketResolution(market_id)
    fetched++

    if (!marketData) {
      resolutionMap.set(condition_id, {
        condition_id,
        market_id,
        resolved_outcome: null,
        payout_yes: null,
        payout_no: null,
        resolved_at: null,
        error: 'Failed to fetch market data',
      })
      errors++
      continue
    }

    // Parse resolution data from Polymarket API response
    // The API returns: closed, active, archived, resolvedAt, outcomePrices
    const isClosed = marketData.closed === true
    const resolvedAt = marketData.resolvedAt || null
    const outcomePrices = marketData.outcomePrices
      ? typeof marketData.outcomePrices === 'string'
        ? JSON.parse(marketData.outcomePrices)
        : marketData.outcomePrices
      : null

    let resolvedOutcome: 'YES' | 'NO' | null = null
    let payoutYes: number | null = null
    let payoutNo: number | null = null

    if (isClosed && outcomePrices && Array.isArray(outcomePrices)) {
      // outcomePrices is [priceYes, priceNo] where 1 means that outcome won
      const [priceYes, priceNo] = outcomePrices.map((p: string) => parseFloat(p))

      payoutYes = priceYes
      payoutNo = priceNo

      // Determine resolved outcome
      if (priceYes === 1 && priceNo === 0) {
        resolvedOutcome = 'YES'
      } else if (priceNo === 1 && priceYes === 0) {
        resolvedOutcome = 'NO'
      }
      // Note: If both are 0.5 or other values, it might be a split/cancelled market
    }

    resolutionMap.set(condition_id, {
      condition_id,
      market_id,
      resolved_outcome: resolvedOutcome,
      payout_yes: payoutYes,
      payout_no: payoutNo,
      resolved_at: resolvedAt,
    })

    if (resolvedOutcome) {
      resolved++
    }

    if (fetched % 10 === 0) {
      console.log(
        `Progress: ${fetched}/${marketMappings.length} markets fetched, ${resolved} resolved`
      )
    }
  }

  console.log(`\n✓ Fetched ${fetched} markets, ${resolved} resolved, ${errors} errors`)

  // Add entries for condition_ids without market_ids
  for (const conditionId of conditionIds) {
    if (!resolutionMap.has(conditionId)) {
      resolutionMap.set(conditionId, {
        condition_id: conditionId,
        market_id: 'unknown',
        resolved_outcome: null,
        payout_yes: null,
        payout_no: null,
        resolved_at: null,
        error: 'No market_id available',
      })
    }
  }

  // Write to JSON
  const resolutionArray = Array.from(resolutionMap.values())
  writeFileSync(
    'condition_resolution_map.json',
    JSON.stringify(
      {
        total_conditions: resolutionArray.length,
        resolved_conditions: resolutionArray.filter((r) => r.resolved_outcome !== null).length,
        resolutions: resolutionArray,
      },
      null,
      2
    )
  )

  console.log('✓ Wrote condition_resolution_map.json\n')

  return resolutionMap
}

// ============================================================================
// STEP 3: Recompute P&L in memory
// ============================================================================

async function recomputePnL(resolutionMap: Map<string, ResolutionData>) {
  console.log('═'.repeat(80))
  console.log('STEP 3: Recomputing P&L for wallet')
  console.log('═'.repeat(80))

  // Fetch all trades for this wallet
  const query = `
    SELECT
      condition_id,
      market_id,
      side,
      entry_price,
      shares,
      timestamp
    FROM trades_raw
    WHERE wallet_address = '${WALLET_ADDRESS}'
    ORDER BY timestamp DESC
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const trades: Trade[] = await result.json()

  console.log(`Loaded ${trades.length} total trades for wallet`)

  let totalPnlUsd = 0
  let fillsUsed = 0
  let fillsUnresolved = 0

  for (const trade of trades) {
    const resolution = resolutionMap.get(trade.condition_id)

    if (!resolution || !resolution.resolved_outcome) {
      fillsUnresolved++
      continue
    }

    // Compute P&L
    const won = trade.side === resolution.resolved_outcome
    const payoutPerShare = won ? 1 : 0
    const tradePnl = parseFloat(trade.shares.toString()) * (payoutPerShare - trade.entry_price)

    totalPnlUsd += tradePnl
    fillsUsed++
  }

  const coveragePct = (fillsUsed / trades.length) * 100

  console.log(`Fills used: ${fillsUsed}`)
  console.log(`Fills unresolved: ${fillsUnresolved}`)
  console.log(`Coverage: ${coveragePct.toFixed(2)}%`)
  console.log(`Computed P&L: $${totalPnlUsd.toFixed(2)}`)

  // Write to JSON
  const result_data = {
    wallet: WALLET_ADDRESS,
    pnl_usd_computed: parseFloat(totalPnlUsd.toFixed(2)),
    fills_used: fillsUsed,
    fills_total: trades.length,
    fills_unresolved: fillsUnresolved,
    coverage_pct: parseFloat(coveragePct.toFixed(2)),
  }

  writeFileSync('wallet_pnl_computed.json', JSON.stringify(result_data, null, 2))

  console.log('✓ Wrote wallet_pnl_computed.json\n')

  return result_data
}

// ============================================================================
// STEP 4: Compare against ground truth
// ============================================================================

async function compareAgainstGroundTruth(computedData: {
  pnl_usd_computed: number
  fills_used: number
  fills_total: number
  coverage_pct: number
}) {
  console.log('═'.repeat(80))
  console.log('STEP 4: Comparing against ground truth')
  console.log('═'.repeat(80))

  // Fetch Goldsky data
  const goldskyData = await fetchWalletPnL(WALLET_ADDRESS)
  const goldskyPnlCorrected = goldskyData
    ? parseFloat((goldskyData.totalRealizedPnl / 13.2399 / 1e6).toFixed(2))
    : 0

  const percentDiffVsPublic =
    (Math.abs(computedData.pnl_usd_computed - GROUND_TRUTH_PNL) / GROUND_TRUTH_PNL) * 100

  const comparison = {
    wallet: WALLET_ADDRESS,
    pnl_polymarket_public_usd: GROUND_TRUTH_PNL,
    pnl_goldsky_corrected_usd: goldskyPnlCorrected,
    pnl_ours_usd: computedData.pnl_usd_computed,
    percent_diff_vs_public: parseFloat(percentDiffVsPublic.toFixed(2)),
    coverage_pct: computedData.coverage_pct,
    fills_used: computedData.fills_used,
    fills_total: computedData.fills_total,
  }

  writeFileSync('comparison.json', JSON.stringify(comparison, null, 2))

  console.log('Ground Truth (Public Profile): $' + GROUND_TRUTH_PNL)
  console.log('Goldsky (Corrected):           $' + goldskyPnlCorrected)
  console.log('Our Computed P&L:              $' + computedData.pnl_usd_computed)
  console.log('Percent Diff vs Public:         ' + percentDiffVsPublic.toFixed(2) + '%')
  console.log('Coverage:                       ' + computedData.coverage_pct.toFixed(2) + '%')

  console.log('\n✓ Wrote comparison.json\n')

  // Validation check
  console.log('═'.repeat(80))
  if (percentDiffVsPublic <= 20) {
    console.log('✅ VALIDATION PASSED: P&L within 20% of ground truth')
  } else if (percentDiffVsPublic <= 100) {
    console.log('⚠️  VALIDATION WARNING: P&L within 2x of ground truth')
  } else {
    console.log('❌ VALIDATION FAILED: P&L more than 2x off from ground truth')
  }
  console.log('═'.repeat(80))

  return comparison
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n')
  console.log('═'.repeat(80))
  console.log('  SINGLE WALLET P&L VALIDATION')
  console.log('  Wallet: ' + WALLET_ADDRESS)
  console.log('═'.repeat(80))
  console.log('\n')

  try {
    // Step 1: Extract condition_ids
    const conditionIds = await extractConditionIds()

    // Step 2: Build resolution map
    const resolutionMap = await buildResolutionMap(conditionIds)

    // Step 3: Recompute P&L
    const computedData = await recomputePnL(resolutionMap)

    // Step 4: Compare against ground truth
    await compareAgainstGroundTruth(computedData)

    console.log('\n✓ All 4 artifacts generated successfully\n')
  } catch (error) {
    console.error('Fatal error:', error)
    throw error
  } finally {
    await clickhouse.close()
  }
}

main()
