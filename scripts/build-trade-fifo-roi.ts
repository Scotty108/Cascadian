#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v1 - Trade-level FIFO ROI calculation
 *
 * Processes by condition_id batches (much faster than wallet-based).
 * For each condition:
 *   1. Get all fills (buys/sells) grouped by wallet/outcome
 *   2. FIFO match: sells consume oldest buys first
 *   3. Remaining tokens held to resolution
 *   4. Calculate per-trade (tx_hash) ROI
 *
 * Then aggregate to wallet metrics in a second pass.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

interface Fill {
  tx_hash: string
  wallet: string
  condition_id: string
  outcome_index: number
  event_time: Date
  tokens_delta: number
  usdc_delta: number
  is_maker: number
}

interface TradeROI {
  tx_hash: string
  wallet: string
  condition_id: string
  outcome_index: number
  entry_time: Date
  tokens: number
  cost_usd: number
  exit_value: number
  pnl_usd: number
  roi: number
  pct_sold_early: number
  is_maker: number
  resolved_at: Date
}

// Safe array min/max to avoid stack overflow
function arrayMin(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((min, val) => val < min ? val : min, arr[0])
}

function arrayMax(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((max, val) => val > max ? val : max, arr[0])
}

async function processConditionBatch(conditionIds: string[], payoutMap: Map<string, { numerators: string, resolved_at: Date }>): Promise<TradeROI[]> {
  const conditionList = conditionIds.map(c => `'${c}'`).join(',')

  // Get all fills for these conditions
  const fillsQuery = `
    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      event_time,
      tokens_delta,
      usdc_delta,
      is_maker
    FROM pm_canonical_fills_v4
    WHERE condition_id IN (${conditionList})
      AND source = 'clob'
      AND wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (is_self_fill = 1 AND is_maker = 1)
    ORDER BY wallet, condition_id, outcome_index, event_time
  `

  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' })
  const fills = await fillsResult.json() as Fill[]

  if (fills.length === 0) return []

  // Group fills by wallet/condition/outcome
  const positions = new Map<string, Fill[]>()
  for (const fill of fills) {
    const key = `${fill.wallet}|${fill.condition_id}|${fill.outcome_index}`
    if (!positions.has(key)) positions.set(key, [])
    positions.get(key)!.push(fill)
  }

  const results: TradeROI[] = []

  for (const [key, posFills] of positions) {
    const [wallet, condition_id, outcome_idx] = key.split('|')
    const outcome_index = parseInt(outcome_idx)

    const payout = payoutMap.get(condition_id)
    if (!payout) continue

    const resolved_at = payout.resolved_at

    // Parse payout rate
    let payoutRate = 0
    if (payout.numerators === '[1,1]') {
      payoutRate = 0.5
    } else if (payout.numerators === '[0,1]' && outcome_index === 1) {
      payoutRate = 1.0
    } else if (payout.numerators === '[1,0]' && outcome_index === 0) {
      payoutRate = 1.0
    }

    // Separate buys and sells, grouped by tx_hash
    const buyTrades = new Map<string, { tokens: number, cost: number, time: Date, is_maker: number }>()
    const sells: { time: Date, tokens: number, proceeds: number }[] = []

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
      } else if (fill.tokens_delta < 0 && fillTime < resolved_at) {
        // Sell before resolution
        sells.push({
          time: fillTime,
          tokens: Math.abs(fill.tokens_delta),
          proceeds: Math.abs(fill.usdc_delta)
        })
      }
    }

    if (buyTrades.size === 0) continue

    // Sort buys by time (FIFO)
    const sortedBuys = Array.from(buyTrades.entries())
      .map(([tx_hash, data]) => ({ tx_hash, ...data }))
      .sort((a, b) => a.time.getTime() - b.time.getTime())

    // Sort sells by time
    sells.sort((a, b) => a.time.getTime() - b.time.getTime())

    // FIFO matching: sells consume oldest buys
    const buyRemaining = sortedBuys.map(b => ({ ...b, remaining: b.tokens }))
    let totalSellProceeds = 0
    let totalTokensSold = 0

    for (const sell of sells) {
      let tokensToMatch = sell.tokens
      totalTokensSold += sell.tokens
      totalSellProceeds += sell.proceeds

      for (const buy of buyRemaining) {
        if (tokensToMatch <= 0) break
        if (buy.remaining <= 0) continue

        const matched = Math.min(buy.remaining, tokensToMatch)
        buy.remaining -= matched
        tokensToMatch -= matched
      }
    }

    // Calculate per-trade ROI
    const totalBuyTokens = sortedBuys.reduce((sum, b) => sum + b.tokens, 0)
    const totalTokensSoldEarly = totalTokensSold
    const pctSoldEarly = totalBuyTokens > 0 ? (totalTokensSoldEarly / totalBuyTokens) * 100 : 0

    for (const buy of buyRemaining) {
      const originalTokens = sortedBuys.find(b => b.tx_hash === buy.tx_hash)!.tokens
      const cost = buy.cost

      if (cost < 0.01) continue // Skip dust trades

      // Portion sold early vs held to resolution
      const tokensSoldEarly = originalTokens - buy.remaining
      const tokensHeld = buy.remaining

      // Exit value = (early sell proceeds proportional) + (held * payout)
      let exitValue = 0

      if (tokensSoldEarly > 0 && totalTokensSold > 0) {
        // Proportional share of sell proceeds
        exitValue += (tokensSoldEarly / totalTokensSold) * totalSellProceeds
      }

      if (tokensHeld > 0) {
        // Held to resolution
        exitValue += tokensHeld * payoutRate
      }

      const pnl = exitValue - cost
      const roi = cost > 0 ? pnl / cost : 0

      results.push({
        tx_hash: buy.tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time: buy.time,
        tokens: originalTokens,
        cost_usd: cost,
        exit_value: exitValue,
        pnl_usd: pnl,
        roi,
        pct_sold_early: pctSoldEarly,
        is_maker: buy.is_maker,
        resolved_at
      })
    }
  }

  return results
}

async function main() {
  const startTime = Date.now()
  console.log('🔧 Building pm_trade_fifo_roi_v1')
  console.log('   Processing by condition batches (14-day active)')
  console.log('')

  // Get conditions with resolved trades in last 14 days
  console.log('📊 Finding conditions to process...')
  const conditionsQuery = `
    SELECT DISTINCT
      f.condition_id,
      r.payout_numerators,
      r.resolved_at
    FROM pm_canonical_fills_v4 f
    INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.source = 'clob'
      AND f.event_time >= now() - INTERVAL 14 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
  `
  const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' })
  const conditions = await conditionsResult.json() as { condition_id: string, payout_numerators: string, resolved_at: string }[]

  console.log(`   Found ${conditions.length.toLocaleString()} conditions`)

  // Build payout map
  const payoutMap = new Map<string, { numerators: string, resolved_at: Date }>()
  for (const c of conditions) {
    payoutMap.set(c.condition_id, {
      numerators: c.payout_numerators,
      resolved_at: new Date(c.resolved_at)
    })
  }

  const conditionIds = conditions.map(c => c.condition_id)
  const batchSize = 50  // Conditions per batch (reduced to avoid memory issues)
  const totalBatches = Math.ceil(conditionIds.length / batchSize)

  console.log(`\n📦 Processing ${totalBatches} batches of ${batchSize} conditions...`)

  let totalInserted = 0
  let totalTrades = 0
  const batchStartTime = Date.now()

  for (let i = 0; i < conditionIds.length; i += batchSize) {
    const batch = conditionIds.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const pct = Math.round((i / conditionIds.length) * 100)

    const elapsed = (Date.now() - batchStartTime) / 1000
    const rate = i > 0 ? i / elapsed : 0
    const remaining = conditionIds.length - i
    const eta = rate > 0 ? Math.round(remaining / rate / 60) : '?'

    process.stdout.write(`\r   Batch ${batchNum}/${totalBatches} (${pct}%) | Trades: ${totalTrades.toLocaleString()} | ETA: ${eta}m   `)

    try {
      const trades = await processConditionBatch(batch, payoutMap)
      totalTrades += trades.length

      if (trades.length > 0) {
        // Insert in sub-batches of 2K to avoid memory/string length issues
        const subBatchSize = 2000
        for (let j = 0; j < trades.length; j += subBatchSize) {
          const subBatch = trades.slice(j, j + subBatchSize)

          await clickhouse.insert({
            table: 'pm_trade_fifo_roi_v1',
            values: subBatch.map(t => ({
              tx_hash: t.tx_hash,
              wallet: t.wallet,
              condition_id: t.condition_id,
              outcome_index: t.outcome_index,
              entry_time: t.entry_time.toISOString().replace('T', ' ').replace('Z', ''),
              tokens: t.tokens,
              cost_usd: t.cost_usd,
              exit_value: t.exit_value,
              pnl_usd: t.pnl_usd,
              roi: t.roi,
              pct_sold_early: t.pct_sold_early,
              is_maker: t.is_maker,
              resolved_at: t.resolved_at.toISOString().replace('T', ' ').replace('Z', '')
            })),
            format: 'JSONEachRow'
          })
          totalInserted += subBatch.length
        }
      }
    } catch (err: any) {
      console.error(`\n   ⚠️ Batch ${batchNum} error: ${err.message.slice(0, 150)}`)
    }
  }

  console.log(`\n\n✅ Processed ${conditionIds.length.toLocaleString()} conditions`)
  console.log(`   Inserted ${totalInserted.toLocaleString()} trade ROIs`)

  // Stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        count(DISTINCT wallet) as unique_wallets,
        countIf(roi > 0) as winning_trades,
        countIf(roi <= 0) as losing_trades,
        round(avg(roi) * 100, 2) as avg_roi_pct,
        round(avg(pct_sold_early), 1) as avg_sold_early
      FROM pm_trade_fifo_roi_v1 FINAL
    `,
    format: 'JSONEachRow'
  })
  const stats = (await statsResult.json() as any[])[0]

  console.log('\n📊 Trade ROI Statistics:')
  console.log(`   Total trades: ${stats.total_trades?.toLocaleString()}`)
  console.log(`   Unique wallets: ${stats.unique_wallets?.toLocaleString()}`)
  console.log(`   Winning trades: ${stats.winning_trades?.toLocaleString()} (${Math.round(stats.winning_trades/stats.total_trades*100)}%)`)
  console.log(`   Losing trades: ${stats.losing_trades?.toLocaleString()}`)
  console.log(`   Avg ROI: ${stats.avg_roi_pct}%`)
  console.log(`   Avg sold early: ${stats.avg_sold_early}%`)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
