#!/usr/bin/env npx tsx
/**
 * Test FIFO calculation for a single wallet
 * Usage: npx tsx scripts/test-fifo-single-wallet.ts <wallet_address>
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

interface Fill {
  tx_hash: string
  condition_id: string
  outcome_index: number
  event_time: string
  tokens_delta: number
  usdc_delta: number
  is_maker: number
  payout_numerators: string
  resolved_at: string
}

interface TradeResult {
  tx_hash: string
  condition_id: string
  outcome_index: number
  entry_time: string
  tokens: number
  cost_usd: number
  exit_value: number
  pnl_usd: number
  roi_pct: number
  exit_type: string  // 'resolution' | 'sold_early' | 'partial'
}

function parsePayoutRate(numerators: string, outcomeIndex: number): number {
  if (numerators === '[1,1]') return 0.5
  if (numerators === '[0,1]' && outcomeIndex === 1) return 1.0
  if (numerators === '[1,0]' && outcomeIndex === 0) return 1.0
  return 0.0
}

async function main() {
  const wallet = process.argv[2] || '0x45d9fd694a79d9bee8b995ad59d9a3aee7a332b1'

  console.log(`\n🔍 FIFO Analysis for wallet: ${wallet}\n`)

  // Get all fills
  const fillsResult = await clickhouse.query({
    query: `
      SELECT
        f.tx_hash,
        f.condition_id,
        f.outcome_index,
        f.event_time,
        f.tokens_delta,
        f.usdc_delta,
        f.is_maker,
        r.payout_numerators,
        r.resolved_at
      FROM pm_canonical_fills_v4 f
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != ''
      WHERE f.wallet = '${wallet}'
        AND f.source = 'clob'
        AND f.event_time >= now() - INTERVAL 30 DAY
        AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
      ORDER BY f.condition_id, f.outcome_index, f.event_time
    `,
    format: 'JSONEachRow'
  })
  const fills = await fillsResult.json() as Fill[]

  console.log(`📊 Found ${fills.length} fills across ${new Set(fills.map(f => f.condition_id)).size} conditions\n`)

  // Group by position (condition_id + outcome_index)
  const positions = new Map<string, Fill[]>()
  for (const fill of fills) {
    const key = `${fill.condition_id}|${fill.outcome_index}`
    if (!positions.has(key)) positions.set(key, [])
    positions.get(key)!.push(fill)
  }

  const results: TradeResult[] = []

  console.log('=' .repeat(120))
  console.log('POSITION-BY-POSITION BREAKDOWN')
  console.log('=' .repeat(120))

  for (const [posKey, posFills] of positions) {
    const [condition_id, outcome_idx] = posKey.split('|')
    const outcomeIndex = parseInt(outcome_idx)
    const payoutRate = parsePayoutRate(posFills[0].payout_numerators, outcomeIndex)
    const resolvedAt = new Date(posFills[0].resolved_at)

    console.log(`\n📍 Position: ${condition_id.slice(0, 16)}... | Outcome: ${outcomeIndex} | Payout: ${payoutRate}`)
    console.log('-'.repeat(120))

    // Separate buys and sells, aggregate by tx_hash
    const buyTrades = new Map<string, { tokens: number, cost: number, time: Date, is_maker: number }>()
    const sells: { time: Date, tokens: number, proceeds: number, tx_hash: string }[] = []

    for (const fill of posFills) {
      const fillTime = new Date(fill.event_time)

      if (fill.tokens_delta > 0) {
        // Buy
        const existing = buyTrades.get(fill.tx_hash)
        if (existing) {
          existing.tokens += fill.tokens_delta
          existing.cost += Math.abs(fill.usdc_delta)
        } else {
          buyTrades.set(fill.tx_hash, {
            tokens: fill.tokens_delta,
            cost: Math.abs(fill.usdc_delta),
            time: fillTime,
            is_maker: fill.is_maker
          })
        }
        console.log(`   BUY  ${fill.tx_hash.slice(0, 16)}... | ${fillTime.toISOString().slice(0, 16)} | ${fill.tokens_delta.toFixed(2)} tokens | $${Math.abs(fill.usdc_delta).toFixed(2)}`)
      } else {
        // Sell
        const isBefore = fillTime < resolvedAt
        sells.push({
          time: fillTime,
          tokens: Math.abs(fill.tokens_delta),
          proceeds: Math.abs(fill.usdc_delta),
          tx_hash: fill.tx_hash
        })
        console.log(`   SELL ${fill.tx_hash.slice(0, 16)}... | ${fillTime.toISOString().slice(0, 16)} | ${Math.abs(fill.tokens_delta).toFixed(2)} tokens | $${Math.abs(fill.usdc_delta).toFixed(2)} ${isBefore ? '(before resolution)' : '(after resolution)'}`)
      }
    }

    if (buyTrades.size === 0) {
      console.log(`   ⚠️ No buys in this position (sells only)`)
      continue
    }

    // Sort buys by time (FIFO)
    const sortedBuys = Array.from(buyTrades.entries())
      .map(([tx_hash, data]) => ({ tx_hash, ...data, remaining: data.tokens }))
      .sort((a, b) => a.time.getTime() - b.time.getTime())

    // Filter sells to only those before resolution
    const validSells = sells.filter(s => s.time < resolvedAt).sort((a, b) => a.time.getTime() - b.time.getTime())

    // FIFO matching
    let totalSellProceeds = 0
    let totalTokensSold = 0

    for (const sell of validSells) {
      let tokensToMatch = sell.tokens
      totalTokensSold += sell.tokens
      totalSellProceeds += sell.proceeds

      for (const buy of sortedBuys) {
        if (tokensToMatch <= 0) break
        if (buy.remaining <= 0) continue

        const matched = Math.min(buy.remaining, tokensToMatch)
        buy.remaining -= matched
        tokensToMatch -= matched
      }
    }

    // Calculate per-trade results
    console.log(`\n   📈 FIFO RESULTS:`)
    const totalBuyTokens = sortedBuys.reduce((sum, b) => sum + b.tokens, 0)

    for (const buy of sortedBuys) {
      if (buy.cost < 0.01) continue

      const tokensSoldEarly = buy.tokens - buy.remaining
      const tokensHeld = buy.remaining

      let exitValue = 0
      let exitType = 'resolution'

      if (tokensSoldEarly > 0 && totalTokensSold > 0) {
        // Proportional share of sell proceeds
        const sellShare = (tokensSoldEarly / totalTokensSold) * totalSellProceeds
        exitValue += sellShare
        exitType = tokensHeld > 0 ? 'partial' : 'sold_early'
      }

      if (tokensHeld > 0) {
        exitValue += tokensHeld * payoutRate
      }

      const pnl = exitValue - buy.cost
      const roi = buy.cost > 0 ? (pnl / buy.cost) * 100 : 0

      console.log(`   ${buy.tx_hash.slice(0, 16)}... | Cost: $${buy.cost.toFixed(2)} | Exit: $${exitValue.toFixed(2)} | PnL: $${pnl.toFixed(2)} | ROI: ${roi.toFixed(1)}% | ${exitType}`)

      results.push({
        tx_hash: buy.tx_hash,
        condition_id,
        outcome_index: outcomeIndex,
        entry_time: buy.time.toISOString(),
        tokens: buy.tokens,
        cost_usd: buy.cost,
        exit_value: exitValue,
        pnl_usd: pnl,
        roi_pct: roi,
        exit_type: exitType
      })
    }
  }

  // Summary
  console.log('\n' + '='.repeat(120))
  console.log('SUMMARY')
  console.log('='.repeat(120))

  const totalCost = results.reduce((sum, r) => sum + r.cost_usd, 0)
  const totalPnl = results.reduce((sum, r) => sum + r.pnl_usd, 0)
  const wins = results.filter(r => r.pnl_usd > 0).length
  const losses = results.filter(r => r.pnl_usd <= 0).length
  const avgRoi = results.reduce((sum, r) => sum + r.roi_pct, 0) / results.length

  console.log(`\n📊 Total Trades: ${results.length}`)
  console.log(`✅ Wins: ${wins} | ❌ Losses: ${losses} | Win Rate: ${(wins / results.length * 100).toFixed(1)}%`)
  console.log(`💰 Total Cost: $${totalCost.toFixed(2)}`)
  console.log(`💵 Total PnL: $${totalPnl.toFixed(2)}`)
  console.log(`📈 Avg ROI: ${avgRoi.toFixed(1)}%`)

  console.log('\n📋 TRADE-BY-TRADE RESULTS:')
  console.log('-'.repeat(120))
  console.log('TX Hash (first 16)      | Cost USD | Exit USD | PnL USD  | ROI %   | Exit Type')
  console.log('-'.repeat(120))
  for (const r of results.sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())) {
    const pnlSign = r.pnl_usd >= 0 ? '+' : ''
    console.log(`${r.tx_hash.slice(0, 20).padEnd(22)} | $${r.cost_usd.toFixed(2).padStart(6)} | $${r.exit_value.toFixed(2).padStart(6)} | ${pnlSign}$${r.pnl_usd.toFixed(2).padStart(5)} | ${r.roi_pct.toFixed(1).padStart(6)}% | ${r.exit_type}`)
  }
}

main().catch(console.error)
