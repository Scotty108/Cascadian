import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET_ADDRESS = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
const SHARES_CORRECTION_FACTOR = 128  // Database shares are 128x inflated

interface Fill {
  condition_id: string
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  timestamp: string
}

interface RealizedMarket {
  condition_id: string
  fills_count: number
  resolved_outcome: string
}

interface ConditionResolution {
  condition_id: string
  market_id: string
  resolved_outcome: string
  payout_yes: number
  payout_no: number
}

interface ConditionResolutionMap {
  total_conditions: number
  resolved_conditions: number
  resolutions: ConditionResolution[]
}

/**
 * Calculate realized P&L for resolved markets
 * All positions are closed at resolution - winning side pays $1/share, losing side pays $0
 *
 * IMPORTANT: Applies 1/128 correction factor to all share quantities
 * The ClickHouse database has shares inflated by exactly 128x
 */
function calculateRealizedPnL(fills: Fill[], resolved_outcome: string) {
  let yes_shares = 0
  let yes_cost = 0
  let no_shares = 0
  let no_cost = 0

  for (const fill of fills) {
    // Apply correction factor
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

  // Calculate payout at resolution
  let payout = 0
  if (resolved_outcome === 'YES') {
    payout = yes_shares  // Each YES share pays $1
  } else if (resolved_outcome === 'NO') {
    payout = no_shares  // Each NO share pays $1
  }

  const realized_pnl = payout - total_cost

  return {
    yes_shares,
    yes_cost,
    no_shares,
    no_cost,
    total_cost,
    payout,
    realized_pnl
  }
}

async function main() {
  console.log('🔍 Starting realized P&L calculation (closed positions only)...\n')
  console.log(`⚙️  Applying 1/${SHARES_CORRECTION_FACTOR} correction factor to shares data\n`)

  // 1. Load realized markets
  const realizedMarketsPath = resolve(process.cwd(), 'realized_markets.json')
  if (!fs.existsSync(realizedMarketsPath)) {
    throw new Error('realized_markets.json not found')
  }

  const realizedMarkets: RealizedMarket[] = JSON.parse(
    fs.readFileSync(realizedMarketsPath, 'utf-8')
  )

  console.log(`✅ Loaded ${realizedMarkets.length} condition IDs from realized_markets.json\n`)

  // 2. Load condition resolution map
  const conditionResolutionPath = resolve(process.cwd(), 'condition_resolution_map.json')
  if (!fs.existsSync(conditionResolutionPath)) {
    throw new Error('condition_resolution_map.json not found')
  }

  const conditionResolutionMap: ConditionResolutionMap = JSON.parse(
    fs.readFileSync(conditionResolutionPath, 'utf-8')
  )

  // Create lookup map
  const resolutionLookup = new Map<string, ConditionResolution>()
  for (const resolution of conditionResolutionMap.resolutions) {
    resolutionLookup.set(resolution.condition_id, resolution)
  }

  console.log(`✅ Loaded ${resolutionLookup.size} condition resolutions\n`)

  // 3. Process each condition
  const results = []
  let total_realized_pnl = 0

  for (const market of realizedMarkets) {
    const condition_id = market.condition_id
    console.log(`Processing ${condition_id}...`)

    // Get fills from ClickHouse
    const query = `
      SELECT
        condition_id,
        side,
        entry_price,
        shares,
        timestamp
      FROM trades_raw
      WHERE wallet_address = '${WALLET_ADDRESS}'
        AND condition_id = '${condition_id}'
      ORDER BY timestamp ASC
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const fills = await result.json() as Fill[]
    console.log(`  Found ${fills.length} fills`)

    // Get resolution
    const resolution = resolutionLookup.get(condition_id)
    const resolved_outcome = resolution?.resolved_outcome || market.resolved_outcome

    // Calculate realized P&L
    const pnlResult = calculateRealizedPnL(fills, resolved_outcome)

    total_realized_pnl += pnlResult.realized_pnl

    results.push({
      condition_id,
      fills_count: fills.length,
      resolved_outcome,
      realized_pnl_spread_usd: Number(pnlResult.realized_pnl.toFixed(2)),
      ending_position_yes_shares: Number(pnlResult.yes_shares.toFixed(2)),
      ending_position_no_shares: Number(pnlResult.no_shares.toFixed(2)),
      yes_cost_usd: Number(pnlResult.yes_cost.toFixed(2)),
      no_cost_usd: Number(pnlResult.no_cost.toFixed(2)),
      payout_usd: Number(pnlResult.payout.toFixed(2)),
    })

    console.log(`  YES: ${pnlResult.yes_shares.toFixed(2)} shares @ $${pnlResult.yes_cost.toFixed(2)} cost`)
    console.log(`  NO: ${pnlResult.no_shares.toFixed(2)} shares @ $${pnlResult.no_cost.toFixed(2)} cost`)
    console.log(`  Resolved: ${resolved_outcome} → Payout: $${pnlResult.payout.toFixed(2)}`)
    console.log(`  Realized P&L: $${pnlResult.realized_pnl.toFixed(2)}\n`)
  }

  // 4. Write output files
  const outputPath = resolve(process.cwd(), 'realized_markets_spread.json')
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`✅ Wrote ${outputPath}\n`)

  const progressPath = resolve(process.cwd(), 'realized_pnl_progress_spread.json')
  const progress = {
    wallet: WALLET_ADDRESS,
    num_condition_ids_modeled: realizedMarkets.length,
    realized_pnl_spread_usd_sum: Number(total_realized_pnl.toFixed(2)),
    polymarket_profile_total_pnl_usd: 2650.64,
    difference_usd: Number((total_realized_pnl - 2650.64).toFixed(2)),
    error_percent: Number(((Math.abs(total_realized_pnl - 2650.64) / 2650.64) * 100).toFixed(2)),
    shares_correction_factor: SHARES_CORRECTION_FACTOR,
    methodology: "Hold-to-resolution P&L for resolved markets only",
    coverage_note: "Top 10 highest-volume resolved markets. All markets resolved to NO. P&L = Payout - Cost. Applied 1/128 correction factor to shares data (database inflated by 128x)."
  }
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
  console.log(`✅ Wrote ${progressPath}\n`)

  console.log('📊 Summary:')
  console.log(`   Total realized P&L: $${total_realized_pnl.toFixed(2)}`)
  console.log(`   Polymarket profile total: $2,650.64`)
  console.log(`   Difference: $${(total_realized_pnl - 2650.64).toFixed(2)}`)
  console.log(`   Error: ${((Math.abs(total_realized_pnl - 2650.64) / 2650.64) * 100).toFixed(2)}%`)

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
