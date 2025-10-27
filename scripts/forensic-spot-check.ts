#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function forensicSpotCheck() {
  const rank1Wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

  console.log('═══════════════════════════════════════════════════════════')
  console.log('    FORENSIC SPOT CHECK - Rank 1 Wallet P&L Verification   ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`Wallet: ${rank1Wallet}\n`)

  // Query 50 enriched trades with resolved_outcome from market_resolution_map
  const query = `
    SELECT
      t.wallet_address,
      t.condition_id,
      t.side,
      t.entry_price,
      t.shares,
      t.was_win,
      t.pnl_net,
      m.resolved_outcome
    FROM trades_raw t
    INNER JOIN market_resolution_map m ON t.condition_id = m.condition_id
    WHERE t.wallet_address = '${rank1Wallet}'
      AND t.pnl_net IS NOT NULL
    LIMIT 50
  `

  console.log('📊 STEP 1: Querying 50 enriched trades from ClickHouse...\n')

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const trades: any[] = await result.json()

  console.log(`Found ${trades.length} trades\n`)
  console.log('═══════════════════════════════════════════════════════════')
  console.log('                    ALL 50 TRADES                          ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Display all 50 trades
  trades.forEach((trade, i) => {
    console.log(`Trade ${i + 1}:`)
    console.log(`  condition_id: ${trade.condition_id}`)
    console.log(`  side: ${trade.side}`)
    console.log(`  entry_price: ${trade.entry_price}`)
    console.log(`  shares: ${trade.shares}`)
    console.log(`  was_win: ${trade.was_win}`)
    console.log(`  resolved_outcome: ${trade.resolved_outcome}`)
    console.log(`  pnl_net: ${trade.pnl_net}`)
    console.log()
  })

  // Manual verification for first 5 trades
  console.log('═══════════════════════════════════════════════════════════')
  console.log('    STEP 2: Manual P&L Verification (First 5 Trades)      ')
  console.log('═══════════════════════════════════════════════════════════\n')

  for (let i = 0; i < Math.min(5, trades.length); i++) {
    const trade = trades[i]

    // Calculate expected P&L
    // Formula: expected_pnl = shares * ((resolved_outcome == side ? 1 : 0) - entry_price)
    const won = trade.resolved_outcome === trade.side
    const payout_per_share = won ? 1.0 : 0.0
    const pnl_per_share = payout_per_share - parseFloat(trade.entry_price)
    const expected_pnl = parseFloat(trade.shares) * pnl_per_share

    const reported_pnl = parseFloat(trade.pnl_net)
    const diff = reported_pnl - expected_pnl

    console.log(`Trade ${i + 1}:`)
    console.log(`  condition_id: ${trade.condition_id.substring(0, 20)}...`)
    console.log(`  side: ${trade.side}`)
    console.log(`  resolved_outcome: ${trade.resolved_outcome}`)
    console.log(`  won: ${won}`)
    console.log(`  shares: ${trade.shares}`)
    console.log(`  entry_price: ${trade.entry_price}`)
    console.log(`  `)
    console.log(`  Calculation:`)
    console.log(`    payout_per_share = ${won ? '1.0' : '0.0'} (${won ? 'won' : 'lost'})`)
    console.log(`    pnl_per_share = ${payout_per_share.toFixed(6)} - ${trade.entry_price} = ${pnl_per_share.toFixed(6)}`)
    console.log(`    expected_pnl = ${trade.shares} × ${pnl_per_share.toFixed(6)} = ${expected_pnl.toFixed(6)}`)
    console.log(`  `)
    console.log(`  Results:`)
    console.log(`    expected_pnl: $${expected_pnl.toFixed(2)}`)
    console.log(`    reported_pnl: $${reported_pnl.toFixed(2)}`)
    console.log(`    diff: $${diff.toFixed(2)} ${Math.abs(diff) < 0.01 ? '✅ MATCH' : '❌ MISMATCH'}`)
    console.log()
  }

  console.log('═══════════════════════════════════════════════════════════')
  console.log('                    SUMMARY                                ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Calculate total from the 50 trades
  const total_pnl_50_trades = trades.reduce(
    (sum, t) => sum + parseFloat(t.pnl_net),
    0
  )
  console.log(`Total P&L from 50 trades: $${total_pnl_50_trades.toFixed(2)}`)
  console.log(`Total enriched trades for wallet: 56,278`)
  console.log(`Average P&L per trade (from 50 sample): $${(total_pnl_50_trades / trades.length).toFixed(2)}`)
  console.log(`Extrapolated total (if all trades similar): $${((total_pnl_50_trades / trades.length) * 56278).toFixed(2)}`)
  console.log()

  await clickhouse.close()
}

forensicSpotCheck()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
