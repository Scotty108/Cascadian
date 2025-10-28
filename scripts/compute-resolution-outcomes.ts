#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🎯 Computing Resolution Outcomes (Conviction Accuracy)\n')

  // Load top 5 wallets
  const samplePath = resolve(process.cwd(), 'data/condition_sample.json')
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'))
  const wallets = sample.wallets.map((w: any) => w.wallet_address)

  console.log(`Processing ${wallets.length} top wallets\n`)

  // Load resolution data
  const resolutionPath = resolve(process.cwd(), 'data/expanded_resolution_map.json')
  const resolutionData = JSON.parse(fs.readFileSync(resolutionPath, 'utf-8'))
  const resolutions = resolutionData.resolutions

  // Build map: condition_id → { outcome: "YES"/"NO", payout_yes, payout_no }
  const resolutionMap = new Map()
  for (const r of resolutions) {
    const outcome = r.payout_yes === 1 ? 'YES' : 'NO'
    resolutionMap.set(r.condition_id, {
      market_id: r.market_id,
      outcome,
      payout_yes: r.payout_yes,
      payout_no: r.payout_no,
      resolved_at: r.resolved_at || new Date().toISOString()
    })
  }

  console.log(`Loaded ${resolutionMap.size} resolved markets\n`)

  // Load category enrichment from condition_market_map
  const categoryResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        canonical_category
      FROM condition_market_map
      WHERE canonical_category != ''
    `,
    format: 'JSONEachRow'
  })

  const categoryRows = await categoryResult.json() as any[]
  const categoryMap = new Map()
  for (const row of categoryRows) {
    categoryMap.set(row.condition_id, row.canonical_category)
  }

  console.log(`Loaded ${categoryMap.size} condition_id → category mappings\n`)

  // For each wallet, compute resolution outcomes
  let totalOutcomes = 0
  let totalWins = 0

  const outcomes: Array<{
    wallet_address: string
    condition_id: string
    market_id: string
    resolved_outcome: string
    final_side: string
    won: number
    resolved_at: string
    canonical_category: string
    num_trades: number
    final_shares: number
  }> = []

  for (const walletAddress of wallets) {
    console.log(`📊 Processing wallet: ${walletAddress}`)

    // Get all trades for this wallet where is_resolved=1
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          side,
          SUM(shares) as shares,
          COUNT(*) as num_trades
        FROM trades_raw
        WHERE wallet_address = '${walletAddress}'
          AND is_resolved = 1
        GROUP BY condition_id, side
        ORDER BY condition_id, side
      `,
      format: 'JSONEachRow'
    })

    const trades = await tradesResult.json() as any[]

    // Group by condition_id and compute final position
    const positionsByCondition = new Map<string, { yes: number, no: number, trades: number }>()

    for (const trade of trades) {
      if (!positionsByCondition.has(trade.condition_id)) {
        positionsByCondition.set(trade.condition_id, { yes: 0, no: 0, trades: 0 })
      }

      const pos = positionsByCondition.get(trade.condition_id)!
      if (trade.side === 'YES') {
        pos.yes += parseFloat(trade.shares)
      } else if (trade.side === 'NO') {
        pos.no += parseFloat(trade.shares)
      }
      pos.trades += parseInt(trade.num_trades)
    }

    console.log(`   Found ${positionsByCondition.size} unique markets\n`)

    // For each position, determine if they won
    let walletWins = 0
    let walletOutcomes = 0

    for (const [conditionId, position] of positionsByCondition.entries()) {
      const resolution = resolutionMap.get(conditionId)
      if (!resolution) {
        continue // Skip if we don't have resolution data
      }

      // Calculate final position
      const netYesShares = position.yes
      const netNoShares = position.no
      const netPosition = netYesShares - netNoShares

      // Determine final side
      let finalSide = ''
      if (Math.abs(netPosition) < 0.01) {
        // Flat position - exclude from hit rate calculation
        continue
      } else if (netPosition > 0) {
        finalSide = 'YES'
      } else {
        finalSide = 'NO'
      }

      // Determine if they won
      const won = finalSide === resolution.outcome ? 1 : 0

      if (won) walletWins++
      walletOutcomes++
      totalWins += won
      totalOutcomes++

      // Get category
      const category = categoryMap.get(conditionId) || 'Uncategorized'

      outcomes.push({
        wallet_address: walletAddress,
        condition_id: conditionId,
        market_id: resolution.market_id,
        resolved_outcome: resolution.outcome,
        final_side: finalSide,
        won,
        resolved_at: resolution.resolved_at,
        canonical_category: category,
        num_trades: position.trades,
        final_shares: netPosition
      })
    }

    const hitRate = walletOutcomes > 0 ? (walletWins / walletOutcomes * 100).toFixed(1) : '0.0'
    console.log(`   Resolution Hit Rate: ${hitRate}% (${walletWins}/${walletOutcomes} markets)\n`)
  }

  console.log(`\n📊 OVERALL STATS`)
  console.log(`   Total outcomes tracked: ${totalOutcomes}`)
  console.log(`   Total wins: ${totalWins}`)
  console.log(`   Overall hit rate: ${(totalWins / totalOutcomes * 100).toFixed(1)}%\n`)

  // Insert into ClickHouse
  if (outcomes.length > 0) {
    console.log(`💾 Inserting ${outcomes.length} resolution outcomes into ClickHouse...\n`)

    const insertQuery = `
      INSERT INTO wallet_resolution_outcomes (
        wallet_address,
        condition_id,
        market_id,
        resolved_outcome,
        final_side,
        won,
        resolved_at,
        canonical_category,
        num_trades,
        final_shares
      ) VALUES
    `

    const values = outcomes.map(o =>
      `('${o.wallet_address}', '${o.condition_id}', '${o.market_id}', '${o.resolved_outcome}', '${o.final_side}', ${o.won}, '${o.resolved_at}', '${o.canonical_category.replace(/'/g, "''")}', ${o.num_trades}, ${o.final_shares})`
    ).join(',\n')

    await clickhouse.command({ query: insertQuery + values })

    console.log('✅ Resolution outcomes inserted\n')

    // Verify
    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as markets_tracked,
          SUM(won) as wins,
          AVG(won) * 100 as hit_rate_pct
        FROM wallet_resolution_outcomes
        GROUP BY wallet_address
        ORDER BY hit_rate_pct DESC
      `,
      format: 'JSONEachRow'
    })

    const verifyRows = await verifyResult.json() as any[]
    console.log('=== Verification: Resolution Hit Rates ===\n')
    for (const row of verifyRows) {
      const shortAddr = `${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}`
      console.log(`${shortAddr}: ${parseFloat(row.hit_rate_pct).toFixed(1)}% (${row.wins}/${row.markets_tracked} markets)`)
    }
  } else {
    console.log('⚠️  No resolution outcomes computed')
  }
}

main()
