import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET_ADDRESS = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
const CORRECTION_FACTOR = 128  // Suspected shares multiplier

interface Fill {
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
}

interface RealizedMarket {
  condition_id: string
  fills_count: number
  resolved_outcome: string
}

async function main() {
  console.log(`🔍 Calculating P&L with 1/${CORRECTION_FACTOR} shares correction...\n`)

  // Load realized markets
  const realizedMarketsPath = resolve(process.cwd(), 'realized_markets.json')
  const realizedMarkets: RealizedMarket[] = JSON.parse(
    fs.readFileSync(realizedMarketsPath, 'utf-8')
  )

  console.log(`✅ Loaded ${realizedMarkets.length} condition IDs\n`)

  const results = []
  let total_pnl = 0

  for (const market of realizedMarkets) {
    const condition_id = market.condition_id
    console.log(`Processing ${condition_id}...`)

    // Get fills
    const query = `
      SELECT side, entry_price, shares
      FROM trades_raw
      WHERE wallet_address = '${WALLET_ADDRESS}' AND condition_id = '${condition_id}'
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const fills = await result.json() as Fill[]

    // Calculate net position and cost WITH CORRECTION
    let yes_shares = 0
    let yes_cost = 0
    let no_shares = 0
    let no_cost = 0

    for (const fill of fills) {
      const corrected_shares = fill.shares / CORRECTION_FACTOR

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
    const resolved_outcome = market.resolved_outcome
    let payout = 0

    if (resolved_outcome === 'YES') {
      payout = yes_shares
    } else if (resolved_outcome === 'NO') {
      payout = no_shares
    }

    const pnl = payout - total_cost

    total_pnl += pnl

    results.push({
      condition_id,
      fills_count: fills.length,
      resolved_outcome,
      yes_shares: Number(yes_shares.toFixed(2)),
      yes_cost: Number(yes_cost.toFixed(2)),
      no_shares: Number(no_shares.toFixed(2)),
      no_cost: Number(no_cost.toFixed(2)),
      total_cost: Number(total_cost.toFixed(2)),
      payout: Number(payout.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
    })

    console.log(`  Corrected YES: ${yes_shares.toFixed(2)} shares @ $${yes_cost.toFixed(2)} cost`)
    console.log(`  Corrected NO: ${no_shares.toFixed(2)} shares @ $${no_cost.toFixed(2)} cost`)
    console.log(`  Resolved: ${resolved_outcome}`)
    console.log(`  Payout: $${payout.toFixed(2)}`)
    console.log(`  P&L: $${pnl.toFixed(2)}\n`)
  }

  // Write output
  const outputPath = resolve(process.cwd(), 'corrected_pnl.json')
  fs.writeFileSync(outputPath, JSON.stringify({
    correction_factor: CORRECTION_FACTOR,
    total_pnl,
    ground_truth: 2650.64,
    difference: total_pnl - 2650.64,
    results
  }, null, 2))

  console.log(`✅ Total corrected P&L: $${total_pnl.toFixed(2)}`)
  console.log(`✅ Ground truth: $2,650.64`)
  console.log(`✅ Difference: $${(total_pnl - 2650.64).toFixed(2)}`)
  console.log(`✅ Error: ${((Math.abs(total_pnl - 2650.64) / 2650.64) * 100).toFixed(2)}%`)
}

main().catch(console.error)
