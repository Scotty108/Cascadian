/**
 * PnL Engine V1 - Spot Check: Top Wallets for UI Verification
 *
 * Extracts detailed PnL breakdowns for top wallets to compare against Polymarket UI
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function spotCheckWallets() {
  console.log('🔍 PnL Engine V1 - Spot Check: Top Wallets for UI Verification\n')
  console.log('=' .repeat(80))

  try {
    // Get top 10 wallets by realized PnL
    console.log('\n📊 Top 10 Wallets by Realized PnL (RESOLVED ONLY)\n')

    const topWalletsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(realized_pnl) as total_realized_pnl,
          sum(CASE WHEN is_winner = 1 THEN realized_pnl ELSE 0 END) as winner_pnl,
          sum(CASE WHEN is_winner = 0 THEN realized_pnl ELSE 0 END) as loser_pnl,
          count() as total_positions,
          count(CASE WHEN is_winner = 1 THEN 1 END) as winner_positions,
          count(CASE WHEN is_winner = 0 THEN 1 END) as loser_positions,
          sum(trade_count) as total_trades,
          count(DISTINCT condition_id) as unique_markets
        FROM vw_pm_realized_pnl_v1
        WHERE is_resolved = 1
        GROUP BY wallet_address
        ORDER BY total_realized_pnl DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const topWallets = await topWalletsResult.json() as Array<{
      wallet_address: string
      total_realized_pnl: number
      winner_pnl: number
      loser_pnl: number
      total_positions: string
      winner_positions: string
      loser_positions: string
      total_trades: string
      unique_markets: string
    }>

    console.log('Rank | Wallet Address (FULL)                      | Net PnL          | Winner PnL       | Loser PnL')
    console.log('-'.repeat(120))

    topWallets.forEach((wallet, i) => {
      const rank = (i + 1).toString().padStart(4)
      const address = wallet.wallet_address.padEnd(42)
      const netPnl = `$${wallet.total_realized_pnl.toFixed(2)}`.padStart(16)
      const winnerPnl = `$${wallet.winner_pnl.toFixed(2)}`.padStart(16)
      const loserPnl = `$${wallet.loser_pnl.toFixed(2)}`.padStart(16)

      console.log(`${rank} | ${address} | ${netPnl} | ${winnerPnl} | ${loserPnl}`)
    })

    // Detailed breakdown for each wallet
    console.log('\n' + '='.repeat(80))
    console.log('📋 DETAILED BREAKDOWN FOR MANUAL UI VERIFICATION\n')

    for (let i = 0; i < topWallets.length; i++) {
      const wallet = topWallets[i]

      console.log(`\n${'='.repeat(80)}`)
      console.log(`Wallet ${i + 1}: ${wallet.wallet_address}`)
      console.log('='.repeat(80))
      console.log()
      console.log(`Net Realized PnL:       $${wallet.total_realized_pnl.toFixed(2).padStart(15)}`)
      console.log(`  From Winners:         $${wallet.winner_pnl.toFixed(2).padStart(15)}  (${wallet.winner_positions} positions)`)
      console.log(`  From Losers:          $${wallet.loser_pnl.toFixed(2).padStart(15)}  (${wallet.loser_positions} positions)`)
      console.log()
      console.log(`Total Resolved Positions: ${parseInt(wallet.total_positions).toLocaleString()}`)
      console.log(`Unique Markets:           ${parseInt(wallet.unique_markets).toLocaleString()}`)
      console.log(`Total Trades:             ${parseInt(wallet.total_trades).toLocaleString()}`)
      console.log()
      console.log(`Polymarket UI Check:`)
      console.log(`  URL: https://polymarket.com/profile/${wallet.wallet_address}`)
      console.log(`  Expected: Net PnL should match $${wallet.total_realized_pnl.toFixed(2)} for RESOLVED markets only`)
      console.log(`  Note: UI may show different total if wallet has open (unresolved) positions`)

      // Get sample resolved markets for this wallet
      console.log()
      console.log(`Sample Resolved Markets (top 5 by |PnL|):`)
      console.log()

      const sampleMarketsResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            outcome_index,
            realized_pnl,
            final_shares,
            trade_count,
            is_winner,
            resolution_time
          FROM vw_pm_realized_pnl_v1
          WHERE wallet_address = '${wallet.wallet_address}'
            AND is_resolved = 1
          ORDER BY abs(realized_pnl) DESC
          LIMIT 5
        `,
        format: 'JSONEachRow',
      })
      const sampleMarkets = await sampleMarketsResult.json() as Array<{
        condition_id: string
        outcome_index: number
        realized_pnl: number
        final_shares: number
        trade_count: string
        is_winner: number
        resolution_time: string
      }>

      console.log('   Market (first 24)       | Out | Realized PnL | Shares | Trades | Status | Resolved')
      console.log('   ' + '-'.repeat(100))

      sampleMarkets.forEach(market => {
        const condId = market.condition_id.slice(0, 23).padEnd(23)
        const outcome = market.outcome_index.toString().padStart(3)
        const pnl = `$${market.realized_pnl.toFixed(2)}`.padStart(12)
        const shares = market.final_shares.toFixed(2).padStart(6)
        const trades = parseInt(market.trade_count).toLocaleString().padStart(6)
        const status = (market.is_winner === 1 ? 'WIN' : 'LOSS').padEnd(6)
        const resolved = new Date(market.resolution_time).toISOString().slice(0, 10)

        console.log(`   ${condId} | ${outcome} | ${pnl} | ${shares} | ${trades} | ${status} | ${resolved}`)
      })
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 VERIFICATION CHECKLIST\n')
    console.log('For each wallet above:')
    console.log('  1. Visit the Polymarket profile URL')
    console.log('  2. Look for "Closed" or "Resolved" positions')
    console.log('  3. Compare net PnL for resolved markets only')
    console.log('  4. Ignore open/unresolved positions (not in V1 scope)')
    console.log('  5. Small differences (<$1) acceptable due to rounding')
    console.log()
    console.log('Expected:')
    console.log('  ✅ Our calculated PnL should match Polymarket for RESOLVED markets')
    console.log('  ⚠️  May differ if wallet has open positions (unrealized PnL not in V1)')
    console.log('  ⚠️  May differ if wallet used CTF split/merge (not in V1)')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the spot check
spotCheckWallets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
