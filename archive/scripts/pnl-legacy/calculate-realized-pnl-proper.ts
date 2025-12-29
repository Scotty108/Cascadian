#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import { readFileSync, writeFileSync } from 'fs'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const WALLET_ADDRESS = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
const GROUND_TRUTH_PNL = 2650.64
const GOLDSKY_PNL = 115.24

interface Fill {
  condition_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  timestamp: string
}

interface PositionSide {
  avg_entry_cost: number
  net_shares: number
  realized_pnl: number
}

interface MarketPosition {
  condition_id: string
  fills_count: number
  resolved_outcome: 'YES' | 'NO'
  yes_side: PositionSide
  no_side: PositionSide
  realized_pnl_usd: number
}

// ============================================================================
// Step 1: Get top 10 condition_ids by volume with known resolution
// ============================================================================

async function getTop10ResolvedConditions(): Promise<string[]> {
  console.log('Finding top 10 highest-volume resolved conditions for wallet...\n')

  // Load resolution map
  const resolutionData = JSON.parse(readFileSync('condition_resolution_map.json', 'utf-8'))
  const resolvedConditions = new Set(
    resolutionData.resolutions
      .filter((r: any) => r.resolved_outcome !== null)
      .map((r: any) => r.condition_id)
  )

  console.log(`Found ${resolvedConditions.size} resolved conditions in map`)

  // Get volume for each condition this wallet traded
  const query = `
    SELECT
      condition_id,
      COUNT(*) as fill_count,
      SUM(toFloat64(shares) * toFloat64(entry_price)) as total_volume_usd
    FROM trades_raw
    WHERE wallet_address = '${WALLET_ADDRESS}'
      AND condition_id IN (${Array.from(resolvedConditions)
        .map((c) => `'${c}'`)
        .join(',')})
    GROUP BY condition_id
    ORDER BY total_volume_usd DESC
    LIMIT 10
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data: Array<{ condition_id: string; fill_count: string; total_volume_usd: string }> =
    await result.json()

  console.log('Top 10 resolved conditions by volume:')
  data.forEach((row, i) => {
    console.log(
      `  ${i + 1}. ${row.condition_id.slice(0, 10)}... (${row.fill_count} fills, $${parseFloat(row.total_volume_usd).toFixed(2)} volume)`
    )
  })
  console.log()

  return data.map((row) => row.condition_id)
}

// ============================================================================
// Step 2: Load all fills for a condition, sorted by timestamp
// ============================================================================

async function loadFillsForCondition(conditionId: string): Promise<Fill[]> {
  const query = `
    SELECT
      condition_id,
      side,
      entry_price,
      shares,
      timestamp
    FROM trades_raw
    WHERE wallet_address = '${WALLET_ADDRESS}'
      AND condition_id = '${conditionId}'
    ORDER BY timestamp ASC
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const fills: Fill[] = await result.json()

  return fills
}

// ============================================================================
// Step 3: Reconstruct position with proper accounting
// ============================================================================

function calculateRealizedPnL(
  fills: Fill[],
  resolvedOutcome: 'YES' | 'NO'
): {
  yes_side: PositionSide
  no_side: PositionSide
  realized_pnl_usd: number
} {
  // Track YES and NO separately
  const yes_side: PositionSide = {
    avg_entry_cost: 0,
    net_shares: 0,
    realized_pnl: 0,
  }

  const no_side: PositionSide = {
    avg_entry_cost: 0,
    net_shares: 0,
    realized_pnl: 0,
  }

  // Process fills chronologically
  for (const fill of fills) {
    const side = fill.side === 'YES' ? yes_side : no_side
    const price = fill.entry_price
    const shares = fill.shares

    // Polymarket fills are always "buys" (increasing position)
    // There's no explicit "sell" - you buy the opposite side to reduce exposure
    // So we always add to the side being bought

    if (side.net_shares === 0) {
      // Opening new position
      side.avg_entry_cost = price
      side.net_shares = shares
    } else {
      // Adding to existing position - update weighted average
      const total_shares = side.net_shares + shares
      side.avg_entry_cost =
        (side.avg_entry_cost * side.net_shares + price * shares) / total_shares
      side.net_shares = total_shares
    }
  }

  // At resolution, settle remaining positions
  const yes_payout = resolvedOutcome === 'YES' ? 1 : 0
  const no_payout = resolvedOutcome === 'NO' ? 1 : 0

  // Realize P&L on remaining YES position
  if (yes_side.net_shares > 0) {
    yes_side.realized_pnl = (yes_payout - yes_side.avg_entry_cost) * yes_side.net_shares
  }

  // Realize P&L on remaining NO position
  if (no_side.net_shares > 0) {
    no_side.realized_pnl = (no_payout - no_side.avg_entry_cost) * no_side.net_shares
  }

  const realized_pnl_usd = yes_side.realized_pnl + no_side.realized_pnl

  return {
    yes_side,
    no_side,
    realized_pnl_usd,
  }
}

// ============================================================================
// Step 4: Process top 10 conditions
// ============================================================================

async function processTop10Markets() {
  console.log('═'.repeat(80))
  console.log('CALCULATING REALIZED P&L WITH PROPER POSITION ACCOUNTING')
  console.log('═'.repeat(80))
  console.log()

  // Get top 10 resolved conditions
  const top10Conditions = await getTop10ResolvedConditions()

  // Load resolution map
  const resolutionData = JSON.parse(readFileSync('condition_resolution_map.json', 'utf-8'))
  const resolutionMap = new Map<string, { resolved_outcome: 'YES' | 'NO' }>()
  resolutionData.resolutions.forEach((r: any) => {
    if (r.resolved_outcome) {
      resolutionMap.set(r.condition_id, { resolved_outcome: r.resolved_outcome })
    }
  })

  const realizedMarkets: MarketPosition[] = []
  let totalRealizedPnl = 0

  console.log('Processing each market...\n')

  for (const conditionId of top10Conditions) {
    const resolution = resolutionMap.get(conditionId)
    if (!resolution) {
      console.log(`⚠️  Skipping ${conditionId.slice(0, 10)}... (no resolution data)`)
      continue
    }

    // Load fills
    const fills = await loadFillsForCondition(conditionId)

    // Calculate realized P&L
    const { yes_side, no_side, realized_pnl_usd } = calculateRealizedPnL(
      fills,
      resolution.resolved_outcome
    )

    const marketPosition: MarketPosition = {
      condition_id: conditionId,
      fills_count: fills.length,
      resolved_outcome: resolution.resolved_outcome,
      yes_side: {
        avg_entry_cost: parseFloat(yes_side.avg_entry_cost.toFixed(6)),
        net_shares: parseFloat(yes_side.net_shares.toFixed(6)),
        realized_pnl: parseFloat(yes_side.realized_pnl.toFixed(2)),
      },
      no_side: {
        avg_entry_cost: parseFloat(no_side.avg_entry_cost.toFixed(6)),
        net_shares: parseFloat(no_side.net_shares.toFixed(6)),
        realized_pnl: parseFloat(no_side.realized_pnl.toFixed(2)),
      },
      realized_pnl_usd: parseFloat(realized_pnl_usd.toFixed(2)),
    }

    realizedMarkets.push(marketPosition)
    totalRealizedPnl += realized_pnl_usd

    console.log(`✓ ${conditionId.slice(0, 10)}... → ${resolution.resolved_outcome}`)
    console.log(`  Fills: ${fills.length}`)
    console.log(
      `  YES: ${yes_side.net_shares.toFixed(2)} shares @ avg $${yes_side.avg_entry_cost.toFixed(4)} → P&L: $${yes_side.realized_pnl.toFixed(2)}`
    )
    console.log(
      `  NO:  ${no_side.net_shares.toFixed(2)} shares @ avg $${no_side.avg_entry_cost.toFixed(4)} → P&L: $${no_side.realized_pnl.toFixed(2)}`
    )
    console.log(`  Total P&L: $${realized_pnl_usd.toFixed(2)}`)
    console.log()
  }

  // Write outputs
  writeFileSync('realized_markets.json', JSON.stringify(realizedMarkets, null, 2))

  const progress = {
    wallet: WALLET_ADDRESS,
    num_condition_ids_modeled: realizedMarkets.length,
    partial_realized_pnl_usd: parseFloat(totalRealizedPnl.toFixed(2)),
    polymarket_profile_total_pnl_usd: GROUND_TRUTH_PNL,
    goldsky_corrected_total_pnl_usd: GOLDSKY_PNL,
    coverage_note: '10 most active resolved markets only',
  }

  writeFileSync('realized_pnl_progress.json', JSON.stringify(progress, null, 2))

  console.log('═'.repeat(80))
  console.log('SUMMARY')
  console.log('═'.repeat(80))
  console.log(`Markets modeled:        ${realizedMarkets.length}`)
  console.log(`Partial realized P&L:   $${totalRealizedPnl.toFixed(2)}`)
  console.log(`Polymarket profile:     $${GROUND_TRUTH_PNL.toFixed(2)}`)
  console.log(`Goldsky corrected:      $${GOLDSKY_PNL.toFixed(2)}`)
  console.log()

  const percentOfProfile = (totalRealizedPnl / GROUND_TRUTH_PNL) * 100
  console.log(`Partial P&L is ${percentOfProfile.toFixed(1)}% of profile total`)

  if (Math.abs(totalRealizedPnl) < 10000 && Math.abs(totalRealizedPnl) > 10) {
    console.log('✅ P&L is in human scale (not inflated by 100x)')
  } else if (Math.abs(totalRealizedPnl) > 100000) {
    console.log('⚠️  P&L still inflated - need to check accounting logic')
  }
  console.log()

  console.log('✓ Wrote realized_markets.json')
  console.log('✓ Wrote realized_pnl_progress.json')
  console.log()
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    await processTop10Markets()
  } catch (error) {
    console.error('Fatal error:', error)
    throw error
  } finally {
    await clickhouse.close()
  }
}

main()
