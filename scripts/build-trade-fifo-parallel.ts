#!/usr/bin/env npx tsx
/**
 * Parallel FIFO builder for Oct 2025 - Jan 2026
 *
 * Uses 4 workers to process conditions in parallel
 * Each worker processes its share of conditions
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
  tokens_sold_early: number
  tokens_held: number
  exit_value: number
  pnl_usd: number
  roi: number
  pct_sold_early: number
  is_maker: number
  resolved_at: Date
}

async function processCondition(
  condition_id: string,
  payout: { numerators: string, resolved_at: Date }
): Promise<TradeROI[]> {
  // Get all fills for this condition
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
    WHERE condition_id = '${condition_id}'
      AND source = 'clob'
      AND wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (is_self_fill = 1 AND is_maker = 1)
    ORDER BY wallet, outcome_index, event_time
  `

  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' })
  const fills = await fillsResult.json() as Fill[]

  if (fills.length === 0) return []

  const resolved_at = payout.resolved_at

  // Parse payout rate
  const payoutRates: number[] = []
  if (payout.numerators === '[1,1]') {
    payoutRates.push(0.5, 0.5)
  } else if (payout.numerators === '[0,1]') {
    payoutRates.push(0, 1.0)
  } else if (payout.numerators === '[1,0]') {
    payoutRates.push(1.0, 0)
  } else {
    return [] // Unknown payout
  }

  // Group fills by wallet/outcome
  const positions = new Map<string, Fill[]>()
  for (const fill of fills) {
    const key = `${fill.wallet}|${fill.outcome_index}`
    if (!positions.has(key)) positions.set(key, [])
    positions.get(key)!.push(fill)
  }

  const results: TradeROI[] = []

  for (const [key, posFills] of positions) {
    const [wallet, outcome_idx] = key.split('|')
    const outcome_index = parseInt(outcome_idx)
    const payoutRate = payoutRates[outcome_index] ?? 0

    // Separate buys and sells
    const buyTrades = new Map<string, { tokens: number, cost: number, time: Date, is_maker: number }>()
    const sells: { time: Date, tokens: number, proceeds: number }[] = []

    for (const fill of posFills) {
      const fillTime = new Date(fill.event_time)

      if (fill.tokens_delta > 0) {
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

    sells.sort((a, b) => a.time.getTime() - b.time.getTime())

    // FIFO matching
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

    const totalBuyTokens = sortedBuys.reduce((sum, b) => sum + b.tokens, 0)
    const pctSoldEarly = totalBuyTokens > 0 ? (totalTokensSold / totalBuyTokens) * 100 : 0

    for (const buy of buyRemaining) {
      const originalTokens = sortedBuys.find(b => b.tx_hash === buy.tx_hash)!.tokens
      const cost = buy.cost

      if (cost < 0.01) continue

      const tokensSoldEarly = originalTokens - buy.remaining
      const tokensHeld = buy.remaining

      let exitValue = 0
      if (tokensSoldEarly > 0 && totalTokensSold > 0) {
        exitValue += (tokensSoldEarly / totalTokensSold) * totalSellProceeds
      }
      if (tokensHeld > 0) {
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
        tokens_sold_early: tokensSoldEarly,
        tokens_held: tokensHeld,
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

async function insertBatch(trades: TradeROI[]) {
  if (trades.length === 0) return

  await clickhouse.insert({
    table: 'pm_trade_fifo_roi_v2',
    values: trades.map(t => ({
      tx_hash: t.tx_hash,
      wallet: t.wallet,
      condition_id: t.condition_id,
      outcome_index: t.outcome_index,
      entry_time: t.entry_time.toISOString().replace('T', ' ').replace('Z', ''),
      tokens: t.tokens,
      cost_usd: t.cost_usd,
      tokens_sold_early: t.tokens_sold_early,
      tokens_held: t.tokens_held,
      exit_value: t.exit_value,
      pnl_usd: t.pnl_usd,
      roi: t.roi,
      pct_sold_early: t.pct_sold_early,
      is_maker: t.is_maker,
      resolved_at: t.resolved_at.toISOString().replace('T', ' ').replace('Z', '')
    })),
    format: 'JSONEachRow'
  })
}

async function processWorker(
  workerId: number,
  conditions: { condition_id: string, payout_numerators: string, resolved_at: string }[],
  progress: { completed: number, trades: number }
) {
  let pendingInserts: TradeROI[] = []
  const insertBatchSize = 5000

  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i]
    try {
      const trades = await processCondition(c.condition_id, {
        numerators: c.payout_numerators,
        resolved_at: new Date(c.resolved_at)
      })

      if (trades.length > 0) {
        pendingInserts.push(...trades)
        progress.trades += trades.length

        if (pendingInserts.length >= insertBatchSize) {
          await insertBatch(pendingInserts)
          pendingInserts = []
        }
      }

      progress.completed++
    } catch (err: any) {
      console.error(`\n   Worker ${workerId} error on ${c.condition_id}: ${err.message.slice(0, 100)}`)
    }
  }

  // Insert remaining
  if (pendingInserts.length > 0) {
    await insertBatch(pendingInserts)
  }
}

async function main() {
  const startTime = Date.now()
  const NUM_WORKERS = 4

  console.log('🔧 Parallel FIFO Builder for Oct 2025 - Jan 2026')
  console.log(`   Using ${NUM_WORKERS} workers`)
  console.log('')

  // Get conditions
  console.log('📊 Finding conditions...')
  const conditionsQuery = `
    SELECT DISTINCT
      r.condition_id,
      r.payout_numerators,
      r.resolved_at
    FROM pm_condition_resolutions r
    WHERE r.is_deleted = 0
      AND r.payout_numerators != ''
      AND r.resolved_at >= '2025-10-01'
      AND r.resolved_at < '2026-02-01'
  `
  const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' })
  const conditions = await conditionsResult.json() as { condition_id: string, payout_numerators: string, resolved_at: string }[]

  console.log(`   Found ${conditions.length.toLocaleString()} conditions`)

  // Split conditions among workers
  const chunkSize = Math.ceil(conditions.length / NUM_WORKERS)
  const chunks: typeof conditions[] = []
  for (let i = 0; i < conditions.length; i += chunkSize) {
    chunks.push(conditions.slice(i, i + chunkSize))
  }

  console.log(`\n📦 Starting ${chunks.length} workers...`)

  // Progress tracking
  const workerProgress = chunks.map(() => ({ completed: 0, trades: 0 }))

  // Progress reporter
  const progressInterval = setInterval(() => {
    const totalCompleted = workerProgress.reduce((sum, p) => sum + p.completed, 0)
    const totalTrades = workerProgress.reduce((sum, p) => sum + p.trades, 0)
    const pct = Math.round((totalCompleted / conditions.length) * 100)
    const elapsed = (Date.now() - startTime) / 1000
    const rate = totalCompleted / elapsed
    const remaining = conditions.length - totalCompleted
    const eta = rate > 0 ? Math.round(remaining / rate / 60) : '?'

    process.stdout.write(`\r   Progress: ${totalCompleted.toLocaleString()}/${conditions.length.toLocaleString()} (${pct}%) | Trades: ${totalTrades.toLocaleString()} | ETA: ${eta}m   `)
  }, 2000)

  // Run workers in parallel
  await Promise.all(
    chunks.map((chunk, i) => processWorker(i + 1, chunk, workerProgress[i]))
  )

  clearInterval(progressInterval)

  const totalTrades = workerProgress.reduce((sum, p) => sum + p.trades, 0)
  console.log(`\n\n✅ Processed ${conditions.length.toLocaleString()} conditions`)
  console.log(`   Inserted ${totalTrades.toLocaleString()} trade ROIs`)

  // Stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniq(wallet) as unique_wallets,
        round(avg(roi) * 100, 2) as avg_roi_pct
      FROM pm_trade_fifo_roi_v2
    `,
    format: 'JSONEachRow'
  })
  const stats = (await statsResult.json() as any[])[0]

  console.log('\n📊 Table now has:')
  console.log(`   Total trades: ${Number(stats.total_trades).toLocaleString()}`)
  console.log(`   Unique wallets: ${Number(stats.unique_wallets).toLocaleString()}`)
  console.log(`   Avg ROI: ${stats.avg_roi_pct}%`)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
