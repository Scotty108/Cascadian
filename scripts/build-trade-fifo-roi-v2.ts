#!/usr/bin/env npx tsx
/**
 * Build pm_trade_fifo_roi_v1 - OPTIMIZED VERSION
 *
 * Processes by WALLET batches (much faster, bounded sizes)
 * Target: 2-day active wallets with 30-day history
 * Expected time: 30-60 minutes
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

function parsePayoutRate(numerators: string, outcomeIndex: number): number {
  if (numerators === '[1,1]') return 0.5
  if (numerators === '[0,1]' && outcomeIndex === 1) return 1.0
  if (numerators === '[1,0]' && outcomeIndex === 0) return 1.0
  return 0.0
}

// Global resolution cache - loaded once at start
let resolutionCache: Map<string, { numerators: string, resolved_at: Date }> | null = null

async function loadResolutionCache(): Promise<Map<string, { numerators: string, resolved_at: Date }>> {
  if (resolutionCache) return resolutionCache

  console.log('   Loading resolution cache...')
  const result = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0 AND payout_numerators != ''
    `,
    format: 'JSONEachRow'
  })
  const rows = await result.json() as { condition_id: string, payout_numerators: string, resolved_at: string }[]

  resolutionCache = new Map()
  for (const r of rows) {
    resolutionCache.set(r.condition_id, {
      numerators: r.payout_numerators,
      resolved_at: new Date(r.resolved_at)
    })
  }
  console.log(`   Cached ${resolutionCache.size.toLocaleString()} resolutions`)
  return resolutionCache
}

async function processWalletBatch(wallets: string[], resolutions: Map<string, { numerators: string, resolved_at: Date }>): Promise<TradeROI[]> {
  const walletList = wallets.map(w => `'${w}'`).join(',')

  // Query fills WITHOUT the expensive JOIN - filter by resolved conditions in JS
  const fillsResult = await clickhouse.query({
    query: `
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
      WHERE wallet IN (${walletList})
        AND source = 'clob'
        AND event_time >= now() - INTERVAL 7 DAY
        AND NOT (is_self_fill = 1 AND is_maker = 1)
      ORDER BY wallet, condition_id, outcome_index, event_time
    `,
    format: 'JSONEachRow'
  })
  const allFills = await fillsResult.json() as { tx_hash: string, wallet: string, condition_id: string, outcome_index: number, event_time: string, tokens_delta: number, usdc_delta: number, is_maker: number }[]

  // Filter to resolved conditions only
  const fills = allFills.filter(f => resolutions.has(f.condition_id))

  if (fills.length === 0) return []

  // Group fills by wallet/condition/outcome
  const positions = new Map<string, (Fill & { wallet: string })[]>()
  for (const fill of fills) {
    const key = `${fill.wallet}|${fill.condition_id}|${fill.outcome_index}`
    if (!positions.has(key)) positions.set(key, [])
    positions.get(key)!.push(fill)
  }

  const results: TradeROI[] = []

  for (const [key, posFills] of positions) {
    const [wallet, condition_id, outcome_idx] = key.split('|')
    const outcome_index = parseInt(outcome_idx)

    const resolution = resolutions.get(condition_id)
    if (!resolution) continue

    const payoutRate = parsePayoutRate(resolution.numerators, outcome_index)
    const resolved_at = resolution.resolved_at

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
    const pctSoldEarly = totalBuyTokens > 0 ? (totalTokensSold / totalBuyTokens) * 100 : 0

    for (const buy of buyRemaining) {
      const originalTokens = sortedBuys.find(b => b.tx_hash === buy.tx_hash)!.tokens
      const cost = buy.cost

      if (cost < 0.01) continue // Skip dust trades

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
  console.log('🔧 Building pm_trade_fifo_roi_v1 (v2 - wallet-based)')
  console.log('   Target: 2-day active wallets with 7-day history')
  console.log('')

  // Get wallets active in last 2 days with 5+ resolved trades in 30 days
  console.log('📊 Finding qualified wallets...')
  const walletsQuery = `
    WITH active_wallets AS (
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND event_time >= now() - INTERVAL 2 DAY
        AND wallet != '0x0000000000000000000000000000000000000000'
    )
    SELECT f.wallet, count(DISTINCT f.tx_hash) as trade_count
    FROM pm_canonical_fills_v4 f
    INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.wallet IN (SELECT wallet FROM active_wallets)
      AND f.source = 'clob'
      AND f.event_time >= now() - INTERVAL 7 DAY
      AND f.tokens_delta > 0
    GROUP BY f.wallet
    HAVING trade_count >= 5 AND trade_count <= 10000  -- Filter out bots
    ORDER BY trade_count DESC
  `
  const walletsResult = await clickhouse.query({ query: walletsQuery, format: 'JSONEachRow' })
  const walletRows = await walletsResult.json() as { wallet: string, trade_count: number }[]

  const wallets = walletRows.map(w => w.wallet)
  console.log(`   Found ${wallets.length.toLocaleString()} qualified wallets`)

  // Load resolution cache upfront (avoids expensive JOINs in batch queries)
  const resolutions = await loadResolutionCache()

  // Dynamic batch sizes - smaller for high-volume wallets (sorted DESC by trade count)
  const getBatchSize = (index: number): number => {
    if (index < 100) return 5     // First 100 wallets: 5 at a time
    if (index < 500) return 10    // Next 400 wallets: 10 at a time
    if (index < 2000) return 25   // Next 1500 wallets: 25 at a time
    return 50                     // Rest: 50 at a time
  }

  console.log(`\n📦 Processing wallets (dynamic batch sizes)...`)

  let totalInserted = 0
  let totalTrades = 0
  const batchStartTime = Date.now()
  let batchNum = 0

  for (let i = 0; i < wallets.length; ) {
    const batchSize = getBatchSize(i)
    const batch = wallets.slice(i, i + batchSize)
    batchNum++
    const pct = Math.round((i / wallets.length) * 100)

    const elapsed = (Date.now() - batchStartTime) / 1000
    const rate = i > 0 ? i / elapsed : 0
    const remaining = wallets.length - i
    const etaMin = rate > 0 ? Math.round(remaining / rate / 60) : '?'

    process.stdout.write(`\r   Batch ${batchNum} (${pct}%) | Wallets: ${i.toLocaleString()}/${wallets.length.toLocaleString()} | Trades: ${totalTrades.toLocaleString()} | ETA: ${etaMin}m   `)

    try {
      const trades = await processWalletBatch(batch, resolutions)
      totalTrades += trades.length

      if (trades.length > 0) {
        // Insert in sub-batches of 2K
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

    i += batchSize  // Move to next batch
  }

  console.log(`\n\n✅ Processed ${wallets.length.toLocaleString()} wallets`)
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
