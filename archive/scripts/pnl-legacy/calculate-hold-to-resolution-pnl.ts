import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET_ADDRESS = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

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

interface ConditionResolution {
  condition_id: string
  resolved_outcome: string
}

async function main() {
  console.log('🔍 Calculating hold-to-resolution P&L (no matching, just track net position)...\n')

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

    // Calculate net position and cost
    let yes_shares = 0
    let yes_cost = 0
    let no_shares = 0
    let no_cost = 0

    for (const fill of fills) {
      if (fill.side === 'YES') {
        yes_shares += fill.shares
        yes_cost += fill.entry_price * fill.shares
      } else {
        no_shares += fill.shares
        no_cost += fill.entry_price * fill.shares
      }
    }

    const total_cost = yes_cost + no_cost

    // Calculate payout at resolution
    const resolved_outcome = market.resolved_outcome
    let payout = 0

    if (resolved_outcome === 'YES') {
      payout = yes_shares  // Each YES share pays $1
    } else if (resolved_outcome === 'NO') {
      payout = no_shares  // Each NO share pays $1
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

    console.log(`  YES: ${yes_shares.toFixed(2)} shares @ $${yes_cost.toFixed(2)} cost`)
    console.log(`  NO: ${no_shares.toFixed(2)} shares @ $${no_cost.toFixed(2)} cost`)
    console.log(`  Resolved: ${resolved_outcome}`)
    console.log(`  Payout: $${payout.toFixed(2)}`)
    console.log(`  P&L: $${pnl.toFixed(2)}\n`)
  }

  // Write output
  const outputPath = resolve(process.cwd(), 'hold_to_resolution_pnl.json')
  fs.writeFileSync(outputPath, JSON.stringify({ total_pnl, results }, null, 2))

  console.log(`✅ Total hold-to-resolution P&L: $${total_pnl.toFixed(2)}`)
  console.log(`✅ Ground truth: $2,650.64`)
  console.log(`✅ Difference: $${(total_pnl - 2650.64).toFixed(2)}`)
}

main().catch(console.error)
