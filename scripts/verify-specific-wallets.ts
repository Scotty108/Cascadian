/**
 * PnL Engine V1 - Verify Specific Wallets Against Polymarket UI
 *
 * Runs comprehensive sanity checks for specific wallets
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLETS = [
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0xb744f56635b537e859152d14b022af5afe485210',
  '0x685eff0c9641faaf8a142dcfcd4883b27cbb6f30',
]

async function verifyWallets() {
  console.log('🔍 PnL Engine V1 - Wallet Verification for UI Comparison\n')
  console.log('=' .repeat(80))
  console.log('\nWallets to verify:')
  WALLETS.forEach((w, i) => console.log(`  ${i + 1}. ${w}`))
  console.log('\n' + '='.repeat(80))

  try {
    // Query 1: Resolved-only PnL
    console.log('\n📊 Query 1: Per-Wallet Summary (RESOLVED ONLY)\n')
    console.log('Compare these numbers to Polymarket UI "Closed/Resolved" positions\n')

    const resolvedOnlyResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(realized_pnl) AS realized_pnl_usdc,
          sum(trade_cash) AS trade_cash_usdc,
          sum(resolution_cash) AS resolution_cash_usdc,
          count(DISTINCT condition_id) AS conditions_traded,
          count() AS total_positions
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address IN (${WALLETS.map(w => `'${w}'`).join(', ')})
          AND is_resolved = 1
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: 'JSONEachRow',
    })
    const resolvedOnly = await resolvedOnlyResult.json() as Array<{
      wallet_address: string
      realized_pnl_usdc: number
      trade_cash_usdc: number
      resolution_cash_usdc: number
      conditions_traded: string
      total_positions: string
    }>

    console.log('Wallet Address                             | Realized PnL    | Trade Cash      | Resolution Cash | Markets | Positions')
    console.log('-'.repeat(140))
    resolvedOnly.forEach(row => {
      const wallet = row.wallet_address.padEnd(42)
      const pnl = `$${row.realized_pnl_usdc.toFixed(2)}`.padStart(15)
      const tradeCash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(15)
      const resCash = `$${row.resolution_cash_usdc.toFixed(2)}`.padStart(15)
      const markets = parseInt(row.conditions_traded).toLocaleString().padStart(7)
      const positions = parseInt(row.total_positions).toLocaleString().padStart(9)
      console.log(`${wallet} | ${pnl} | ${tradeCash} | ${resCash} | ${markets} | ${positions}`)
    })

    // Query 2: All positions (including open)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 2: Per-Wallet Summary (ALL POSITIONS - Including Open)\n')
    console.log('UI may show higher totals if wallet has open positions (unrealized PnL)\n')

    const allPositionsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(realized_pnl) AS realized_pnl_usdc,
          sum(trade_cash) AS trade_cash_usdc,
          sum(resolution_cash) AS resolution_cash_usdc,
          count(DISTINCT condition_id) AS conditions_traded,
          sum(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) AS open_positions,
          sum(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS closed_positions
        FROM vw_pm_realized_pnl_v1
        WHERE wallet_address IN (${WALLETS.map(w => `'${w}'`).join(', ')})
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: 'JSONEachRow',
    })
    const allPositions = await allPositionsResult.json() as Array<{
      wallet_address: string
      realized_pnl_usdc: number
      trade_cash_usdc: number
      resolution_cash_usdc: number
      conditions_traded: string
      open_positions: string
      closed_positions: string
    }>

    console.log('Wallet Address                             | Realized PnL    | Trade Cash      | Resolution Cash | Open Pos | Closed Pos')
    console.log('-'.repeat(135))
    allPositions.forEach(row => {
      const wallet = row.wallet_address.padEnd(42)
      const pnl = `$${row.realized_pnl_usdc.toFixed(2)}`.padStart(15)
      const tradeCash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(15)
      const resCash = `$${row.resolution_cash_usdc.toFixed(2)}`.padStart(15)
      const openPos = parseInt(row.open_positions).toLocaleString().padStart(8)
      const closedPos = parseInt(row.closed_positions).toLocaleString().padStart(10)
      console.log(`${wallet} | ${pnl} | ${tradeCash} | ${resCash} | ${openPos} | ${closedPos}`)
    })

    // Query 3: Top markets per wallet
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Top Markets Per Wallet (RESOLVED ONLY)\n')
    console.log('Top 10 markets by |PnL| for each wallet\n')

    for (const wallet of WALLETS) {
      const topMarketsResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            sum(realized_pnl) AS pnl_usdc,
            sum(trade_cash) AS trade_cash_usdc,
            sum(resolution_cash) AS resolution_cash_usdc,
            sum(final_shares) AS net_shares,
            sum(trade_count) AS trades
          FROM vw_pm_realized_pnl_v1
          WHERE wallet_address = '${wallet}'
            AND is_resolved = 1
          GROUP BY condition_id
          ORDER BY abs(pnl_usdc) DESC
          LIMIT 10
        `,
        format: 'JSONEachRow',
      })
      const topMarkets = await topMarketsResult.json() as Array<{
        condition_id: string
        pnl_usdc: number
        trade_cash_usdc: number
        resolution_cash_usdc: number
        net_shares: number
        trades: string
      }>

      console.log(`Wallet: ${wallet}`)
      console.log('   Market (first 24)       | PnL             | Trade Cash      | Resolution Cash | Net Shares  | Trades')
      console.log('   ' + '-'.repeat(115))

      topMarkets.forEach(market => {
        const condId = market.condition_id.slice(0, 23).padEnd(23)
        const pnl = `$${market.pnl_usdc.toFixed(2)}`.padStart(15)
        const tradeCash = `$${market.trade_cash_usdc.toFixed(2)}`.padStart(15)
        const resCash = `$${market.resolution_cash_usdc.toFixed(2)}`.padStart(15)
        const shares = market.net_shares.toFixed(2).padStart(11)
        const trades = parseInt(market.trades).toLocaleString().padStart(6)
        console.log(`   ${condId} | ${pnl} | ${tradeCash} | ${resCash} | ${shares} | ${trades}`)
      })
      console.log()
    }

    // Query 4: Basic ledger sanity
    console.log('='.repeat(80))
    console.log('\n📊 Query 4: Basic Ledger Sanity Check (ALL TRADES)\n')
    console.log('Shows net shares and cash across ALL trades (resolved and unresolved)\n')

    const ledgerSanityResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(shares_delta) AS net_shares_all,
          sum(cash_delta_usdc) AS net_cash_all,
          count() AS total_trades
        FROM vw_pm_ledger
        WHERE wallet_address IN (${WALLETS.map(w => `'${w}'`).join(', ')})
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: 'JSONEachRow',
    })
    const ledgerSanity = await ledgerSanityResult.json() as Array<{
      wallet_address: string
      net_shares_all: number
      net_cash_all: number
      total_trades: string
    }>

    console.log('Wallet Address                             | Net Shares (All) | Net Cash (All)  | Total Trades')
    console.log('-'.repeat(110))
    ledgerSanity.forEach(row => {
      const wallet = row.wallet_address.padEnd(42)
      const shares = row.net_shares_all.toFixed(2).padStart(16)
      const cash = `$${row.net_cash_all.toFixed(2)}`.padStart(15)
      const trades = parseInt(row.total_trades).toLocaleString().padStart(12)
      console.log(`${wallet} | ${shares} | ${cash} | ${trades}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 HOW TO COMPARE WITH POLYMARKET UI\n')
    console.log('For each wallet:')
    console.log('  1. Visit: https://polymarket.com/profile/[wallet_address]')
    console.log('  2. Look for "Closed" or "Resolved" positions section')
    console.log('  3. Compare Query 1 "Realized PnL" to UI total for resolved markets')
    console.log('  4. Spot-check 1-2 largest resolved markets (Query 3) against UI')
    console.log()
    console.log('Expected:')
    console.log('  ✅ Query 1 (resolved-only) should match UI "Closed/Resolved" PnL')
    console.log('  ⚠️  Query 2 (all positions) may differ if wallet has open positions')
    console.log('  ⚠️  May differ if wallet used CTF split/merge (not in V1)')
    console.log('  ⚠️  Small differences (<$1) acceptable due to rounding')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the verification
verifyWallets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
