/**
 * Investigate the specific problematic market
 * f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const MARKET = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function investigateMarket() {
  console.log('🔍 Investigating Specific Market\n')
  console.log('='.repeat(80))
  console.log(`\nMarket: ${MARKET}`)
  console.log(`Wallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // Check raw resolution data
    console.log('\n📊 Raw Resolution Data\n')

    const resolutionDataResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          payout_numerators,
          payout_denominator,
          resolved_at,
          tx_hash
        FROM pm_condition_resolutions
        WHERE lower(condition_id) = '${MARKET}'
          AND is_deleted = 0
      `,
      format: 'JSONEachRow',
    })
    const resolutionData = await resolutionDataResult.json() as Array<{
      condition_id: string
      payout_numerators: string
      payout_denominator: string
      resolved_at: string
      tx_hash: string
    }>

    if (resolutionData.length > 0) {
      const res = resolutionData[0]
      console.log(`Condition ID:       ${res.condition_id}`)
      console.log(`Payout Numerators:  ${res.payout_numerators}`)
      console.log(`Payout Denominator: ${res.payout_denominator}`)
      console.log(`Resolved At:        ${res.resolved_at}`)
      console.log(`TX Hash:            ${res.tx_hash}`)
    } else {
      console.log('⚠️  No resolution found in pm_condition_resolutions')
    }

    // Check resolution prices view
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Resolution Prices View\n')

    const resPricesResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          resolved_price,
          resolution_time
        FROM vw_pm_resolution_prices
        WHERE condition_id = '${MARKET}'
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow',
    })
    const resPrices = await resPricesResult.json() as Array<{
      condition_id: string
      outcome_index: number
      resolved_price: number
      resolution_time: string
    }>

    console.log('Outcome | Resolved Price | Resolution Time')
    console.log('-'.repeat(60))
    resPrices.forEach(row => {
      const outcome = row.outcome_index.toString().padStart(7)
      const price = row.resolved_price.toFixed(4).padStart(14)
      const time = new Date(row.resolution_time).toISOString()
      console.log(`${outcome} | ${price} | ${time}`)
    })

    const totalPrice = resPrices.reduce((sum, r) => sum + r.resolved_price, 0)
    console.log(`\nTotal Resolved Price: ${totalPrice.toFixed(4)} (should be 1.0000 for valid markets)`)

    // Check wallet positions
    console.log('\n' + '='.repeat(80))
    console.log(`\n📊 Wallet Positions in This Market\n`)

    const positionsResult = await clickhouse.query({
      query: `
        SELECT
          outcome_index,
          trade_cash,
          final_shares,
          resolution_cash,
          realized_pnl,
          trade_count,
          is_resolved,
          is_winner,
          resolved_price
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address = '${WALLET}'
          AND condition_id = '${MARKET}'
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow',
    })
    const positions = await positionsResult.json() as Array<{
      outcome_index: number
      trade_cash: number
      final_shares: number
      resolution_cash: number
      realized_pnl: number
      trade_count: string
      is_resolved: number
      is_winner: number
      resolved_price: number
    }>

    console.log('Outcome | Trade Cash  | Final Shares | Res Price | Res Cash    | PnL         | Trades | Resolved | Winner')
    console.log('-'.repeat(115))
    positions.forEach(row => {
      const outcome = row.outcome_index.toString().padStart(7)
      const tradeCash = `$${row.trade_cash.toFixed(2)}`.padStart(11)
      const shares = row.final_shares.toFixed(2).padStart(12)
      const resPrice = row.resolved_price ? row.resolved_price.toFixed(4) : 'NULL'
      resPrice.padStart(9)
      const resCash = `$${row.resolution_cash.toFixed(2)}`.padStart(11)
      const pnl = `$${row.realized_pnl.toFixed(2)}`.padStart(11)
      const trades = parseInt(row.trade_count).toLocaleString().padStart(6)
      const resolved = (row.is_resolved === 1 ? 'YES' : 'NO').padEnd(8)
      const winner = (row.is_winner === 1 ? 'YES' : 'NO').padEnd(6)
      console.log(`${outcome} | ${tradeCash} | ${shares} | ${resPrice.padStart(9)} | ${resCash} | ${pnl} | ${trades} | ${resolved} | ${winner}`)
    })

    const marketTotal = positions.reduce((sum, p) => sum + p.realized_pnl, 0)
    console.log(`\nMarket Total PnL: $${marketTotal.toFixed(2)}`)

    // Check individual trades
    console.log('\n' + '='.repeat(80))
    console.log(`\n📊 Individual Trades (Sample - First 10)\n`)

    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          outcome_index,
          side,
          shares_delta,
          cash_delta_usdc,
          fee_usdc,
          block_time
        FROM vw_pm_ledger
        WHERE wallet_address = '${WALLET}'
          AND condition_id = '${MARKET}'
        ORDER BY block_time
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const trades = await tradesResult.json() as Array<{
      outcome_index: number
      side: string
      shares_delta: number
      cash_delta_usdc: number
      fee_usdc: number
      block_time: string
    }>

    console.log('Outcome | Side | Shares Delta | Cash Delta | Fee       | Time')
    console.log('-'.repeat(90))
    trades.forEach(row => {
      const outcome = row.outcome_index.toString().padStart(7)
      const side = row.side.padEnd(4)
      const shares = row.shares_delta.toFixed(2).padStart(12)
      const cash = `$${row.cash_delta_usdc.toFixed(2)}`.padStart(10)
      const fee = `$${row.fee_usdc.toFixed(2)}`.padStart(9)
      const time = new Date(row.block_time).toISOString().slice(0, 19)
      console.log(`${outcome} | ${side} | ${shares} | ${cash} | ${fee} | ${time}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 FINDINGS\n')

    if (totalPrice < 0.01) {
      console.log('⚠️  INVALID MARKET: Total resolved price is near zero')
      console.log('   This market was likely canceled or had an invalid resolution')
      console.log('   Polymarket UI likely excludes this from PnL calculations')
      console.log(`   Impact on wallet: $${marketTotal.toFixed(2)}`)
    } else if (Math.abs(totalPrice - 1.0) < 0.01) {
      console.log('✅ VALID MARKET: Total resolved price sums to 1.0')
      console.log('   This is a properly resolved market')
      console.log(`   Wallet PnL: $${marketTotal.toFixed(2)}`)
      console.log('   If UI shows different PnL, check:')
      console.log('     1. Is this market visible in UI?')
      console.log('     2. Are all trades captured?')
      console.log('     3. Does UI handle multi-outcome differently?')
    } else {
      console.log(`⚠️  UNUSUAL: Total resolved price = ${totalPrice.toFixed(4)} (expected 1.0)`)
      console.log('   This may be a multi-outcome market with fractional payouts')
    }

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

investigateMarket()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
