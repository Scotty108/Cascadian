#!/usr/bin/env npx tsx

/**
 * Theo-only PnL recalculation with net_shares floor at zero
 *
 * Problem: When a wallet sells shares before resolution, we double-count:
 * - The sell generates positive trading PnL (correct)
 * - We ALSO count sold shares for resolution payout (INCORRECT)
 *
 * Fix: net_shares = max(prev + buys - sells, 0)
 *
 * Expected result: ~$22M (matching Goldsky pm_user_positions)
 * Current broken: ~$33M
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

interface Fill {
  condition_id: string
  outcome_index: number
  side: string
  usdc_amount: number
  token_amount: number
  fee_amount: number
  payout_numerators: string
}

interface Position {
  condition_id: string
  outcome_index: number
  bought_usdc: number
  sold_usdc: number
  fees: number
  bought_shares: number
  sold_shares: number
  net_shares: number  // Will be floored at 0
  payout_numerators: string
}

async function main() {
  console.log('\n🔬 THEO PnL RECALCULATION WITH NET_SHARES FLOOR')
  console.log('================================================\n')
  console.log(`Wallet: ${THEO}`)
  console.log('Expected: ~$22M (matching Goldsky)')
  console.log('Current broken: ~$33M\n')

  // Step 1: Get all Theo's fills with resolution info
  console.log('📊 Step 1: Fetching Theo fills...')

  const fillsResult = await clickhouse.query({
    query: `
      SELECT
        m.condition_id AS condition_id,
        m.outcome_index AS outcome_index,
        t.side AS side,
        t.usdc_amount AS usdc_amount,
        t.token_amount AS token_amount,
        t.fee_amount AS fee_amount,
        coalesce(r.payout_numerators, '[]') as payout_numerators
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
      LEFT JOIN pm_condition_resolutions r ON r.condition_id = m.condition_id
      WHERE t.trader_wallet = '${THEO}'
        AND t.is_deleted = 0
      ORDER BY t.trade_time
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 }
  })

  const fills: Fill[] = await fillsResult.json() as Fill[]
  console.log(`  Found ${fills.length} fills\n`)

  // Step 2: Build positions with rolling accumulation and floor
  console.log('📊 Step 2: Building positions with net_shares floor...')

  const positions = new Map<string, Position>()

  for (const fill of fills) {
    const key = `${fill.condition_id}-${fill.outcome_index}`

    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: fill.condition_id,
        outcome_index: fill.outcome_index,
        bought_usdc: 0,
        sold_usdc: 0,
        fees: 0,
        bought_shares: 0,
        sold_shares: 0,
        net_shares: 0,
        payout_numerators: fill.payout_numerators,
      })
    }

    const pos = positions.get(key)!
    const side = fill.side.toLowerCase()

    if (side === 'buy') {
      pos.bought_usdc += fill.usdc_amount
      pos.bought_shares += fill.token_amount
      pos.net_shares += fill.token_amount
    } else if (side === 'sell') {
      pos.sold_usdc += fill.usdc_amount
      pos.sold_shares += fill.token_amount
      pos.net_shares -= fill.token_amount

      // KEY FIX: Floor net_shares at zero
      pos.net_shares = Math.max(0, pos.net_shares)
    }

    pos.fees += fill.fee_amount
  }

  console.log(`  Built ${positions.size} unique positions\n`)

  // Step 3: Compute PnL for each position
  console.log('📊 Step 3: Computing PnL with corrected net_shares...\n')

  let totalBought = 0
  let totalSold = 0
  let totalFees = 0
  let totalTradingPnl = 0
  let totalResolutionPayout = 0
  let resolvedPositions = 0
  let winningPositions = 0
  let topPositions: { key: string, tradingPnl: number, resolutionPayout: number, totalPnl: number }[] = []

  for (const [key, pos] of positions) {
    // Scale from atomic units to USD
    const boughtUsdc = pos.bought_usdc / 1e6
    const soldUsdc = pos.sold_usdc / 1e6
    const fees = pos.fees / 1e6
    const netShares = pos.net_shares / 1e6

    totalBought += boughtUsdc
    totalSold += soldUsdc
    totalFees += fees

    // Trading PnL = sold - bought - fees
    const tradingPnl = soldUsdc - boughtUsdc - fees
    totalTradingPnl += tradingPnl

    // Resolution payout = net_shares * outcome_won
    let resolutionPayout = 0
    if (pos.payout_numerators && pos.payout_numerators !== '[]') {
      resolvedPositions++
      try {
        const payouts = JSON.parse(pos.payout_numerators)
        const outcomeWon = payouts[pos.outcome_index] === 1 ? 1 : 0
        if (outcomeWon === 1) {
          winningPositions++
          resolutionPayout = netShares  // net_shares is already floored at 0
        }
      } catch (e) {
        // Parse error, skip
      }
    }
    totalResolutionPayout += resolutionPayout

    const totalPnl = tradingPnl + resolutionPayout
    topPositions.push({ key, tradingPnl, resolutionPayout, totalPnl })
  }

  // Sort by absolute total PnL
  topPositions.sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))

  // Display top 5 positions
  console.log('TOP 5 POSITIONS BY |TOTAL PnL|:')
  console.log('-'.repeat(70))
  for (let i = 0; i < Math.min(5, topPositions.length); i++) {
    const p = topPositions[i]
    console.log(`${i+1}. ${p.key.substring(0, 20)}...`)
    console.log(`   Trading PnL: $${p.tradingPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
    console.log(`   Resolution:  $${p.resolutionPayout.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
    console.log(`   Total:       $${p.totalPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
    console.log()
  }

  // Final summary
  const totalPnl = totalTradingPnl + totalResolutionPayout

  console.log('='.repeat(70))
  console.log('THEO PnL SUMMARY (WITH NET_SHARES FLOOR)')
  console.log('='.repeat(70))
  console.log()
  console.log(`Positions:          ${positions.size}`)
  console.log(`  Resolved:         ${resolvedPositions}`)
  console.log(`  Winning:          ${winningPositions}`)
  console.log()
  console.log(`Volume:`)
  console.log(`  Bought:           $${totalBought.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log(`  Sold:             $${totalSold.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log(`  Fees:             $${totalFees.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log()
  console.log(`PnL:`)
  console.log(`  Trading PnL:      $${totalTradingPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log(`  Resolution:       $${totalResolutionPayout.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log(`  ─────────────────────────────────`)
  console.log(`  TOTAL PnL:        $${totalPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log()
  console.log('='.repeat(70))
  console.log('VALIDATION:')
  console.log(`  Expected (Goldsky):  ~$22,000,000`)
  console.log(`  Previous (broken):   ~$33,000,000`)
  console.log(`  Computed (fixed):    $${totalPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  console.log()

  const diff = Math.abs(totalPnl - 22000000)
  const pctDiff = (diff / 22000000) * 100
  if (pctDiff < 10) {
    console.log(`  ✅ MATCH! Within ${pctDiff.toFixed(1)}% of expected`)
  } else {
    console.log(`  ❌ MISMATCH: ${pctDiff.toFixed(1)}% off from expected`)
  }
  console.log('='.repeat(70))

  await clickhouse.close()
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
