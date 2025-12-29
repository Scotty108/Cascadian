/**
 * Investigate Specific Egg Market Issues
 *
 * Issue 1: "More than $6.00 in March" (8e02dc...) - 0 trades (100% missing)
 * Issue 2: "Below $4.50 in May" (ee3a38...) - PnL 36% lower than UI
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const MISSING_MARKET = '8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39' // more than $6 March
const SHORTFALL_MARKET = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2' // below $4.50 May

async function investigateSpecificMarkets() {
  console.log('🔍 Investigating Specific Egg Market Issues\n')
  console.log('='.repeat(80))
  console.log('\nIssue 1: "More than $6.00 in March" - 0 trades (100% missing)')
  console.log('  condition_id: ' + MISSING_MARKET)
  console.log('  Expected PnL: $25,528.83')
  console.log('  Our PnL: $0.00')
  console.log()
  console.log('Issue 2: "Below $4.50 in May" - PnL 36% lower than UI')
  console.log('  condition_id: ' + SHORTFALL_MARKET)
  console.log('  Expected PnL: $41,289.47')
  console.log('  Our PnL: $26,187.88')
  console.log('  Gap: -$15,101.59 (36.6%)')
  console.log('='.repeat(80))

  try {
    // ========================================
    // A) Check token mapping for MISSING market (8e02dc...)
    // ========================================
    console.log('\n📊 A) Token Mapping for MISSING Market (more than $6 March)\n')

    const missingTokensResult = await clickhouse.query({
      query: `
        SELECT token_id_dec, outcome_index
        FROM pm_token_to_condition_map_v3
        WHERE lower(condition_id) = '${MISSING_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const missingTokens = await missingTokensResult.json() as Array<{
      token_id_dec: string
      outcome_index: number
    }>

    if (missingTokens.length > 0) {
      console.log(`Found ${missingTokens.length} token(s) mapped to this condition:\n`)
      missingTokens.forEach(t => {
        console.log(`  token_id: ${t.token_id_dec}, outcome_index: ${t.outcome_index}`)
      })

      // Check trades for these tokens (all wallets)
      const tokenIds = missingTokens.map(t => t.token_id_dec)
      const tradesAllResult = await clickhouse.query({
        query: `
          SELECT count(*) AS trades_all
          FROM pm_trader_events_v2
          WHERE toString(token_id) IN (${tokenIds.map(id => `'${id}'`).join(', ')})
        `,
        format: 'JSONEachRow'
      })
      const tradesAll = await tradesAllResult.json() as Array<{ trades_all: string }>

      console.log()
      console.log(`Trades for these tokens (all wallets): ${parseInt(tradesAll[0].trades_all).toLocaleString()}`)

      // Check trades for our specific wallet
      const tradesWalletResult = await clickhouse.query({
        query: `
          SELECT count(*) AS trades_wallet
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${WALLET}'
            AND toString(token_id) IN (${tokenIds.map(id => `'${id}'`).join(', ')})
        `,
        format: 'JSONEachRow'
      })
      const tradesWallet = await tradesWalletResult.json() as Array<{ trades_wallet: string }>

      const walletTrades = parseInt(tradesWallet[0].trades_wallet)
      const allTrades = parseInt(tradesAll[0].trades_all)

      console.log(`Trades for our wallet: ${walletTrades}`)
      console.log()

      if (allTrades === 0) {
        console.log('🔴 INGESTION GAP: No trades for these token_ids in pm_trader_events_v2')
        console.log('   This market is completely missing from our data!')
      } else if (walletTrades === 0) {
        console.log('⚠️  Trades exist for other wallets but NOT for our wallet')
        console.log('   This could mean:')
        console.log('   1. UI screenshot is from a different wallet')
        console.log('   2. This wallet truly did not trade this market')
      } else {
        console.log(`✅ Found ${walletTrades} trades for our wallet`)
        console.log('   But these are NOT appearing in vw_pm_ledger_v2!')
        console.log('   → Mapping/join issue between pm_trader_events_v2 and token map')
      }
    } else {
      console.log('🔴 NO TOKEN MAPPING for this condition_id!')
      console.log('   This is a critical mapping gap in pm_token_to_condition_map_v3')
    }

    // ========================================
    // B) Check token mapping & payouts for SHORTFALL market (ee3a38...)
    // ========================================
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 B) Token Mapping & Payouts for SHORTFALL Market (below $4.50 May)\n')

    const shortfallTokensResult = await clickhouse.query({
      query: `
        SELECT token_id_dec, outcome_index
        FROM pm_token_to_condition_map_v3
        WHERE lower(condition_id) = '${SHORTFALL_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const shortfallTokens = await shortfallTokensResult.json() as Array<{
      token_id_dec: string
      outcome_index: number
    }>

    console.log(`Token mapping:\n`)
    shortfallTokens.forEach(t => {
      console.log(`  token_id: ${t.token_id_dec}, outcome_index: ${t.outcome_index}`)
    })

    // Get resolution payout
    const payoutResult = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE lower(condition_id) = '${SHORTFALL_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const payout = await payoutResult.json() as Array<{ payout_numerators: string }>

    console.log()
    console.log(`Resolution payout: ${payout[0].payout_numerators}`)

    // Parse payout to see which outcome won
    const payoutArray = JSON.parse(payout[0].payout_numerators) as number[]
    const winnerIndex = payoutArray.findIndex(p => p > 0)
    console.log(`Winner outcome_index: ${winnerIndex}`)

    // Get wallet trades by outcome
    const tokenIdsShortfall = shortfallTokens.map(t => t.token_id_dec)
    const tradesByOutcomeResult = await clickhouse.query({
      query: `
        WITH toks AS (
          SELECT token_id_dec, outcome_index
          FROM pm_token_to_condition_map_v3
          WHERE lower(condition_id) = '${SHORTFALL_MARKET}'
        )
        SELECT
          k.outcome_index,
          sum(toFloat64(t.token_amount)/1e6) AS shares,
          sum(toFloat64(t.usdc_amount)/1e6) AS usdc,
          sum(toFloat64(t.fee_amount)/1e6) AS fee,
          sum(toFloat64(t.token_amount)/1e6 * if(lower(t.side)='buy', 1, -1)) AS net_shares_dir
        FROM pm_trader_events_v2 t
        JOIN toks k ON toString(t.token_id) = toString(k.token_id_dec)
        WHERE lower(t.trader_wallet) = '${WALLET}'
        GROUP BY k.outcome_index
      `,
      format: 'JSONEachRow'
    })
    const tradesByOutcome = await tradesByOutcomeResult.json() as Array<{
      outcome_index: number
      shares: number
      usdc: number
      fee: number
      net_shares_dir: number
    }>

    console.log()
    console.log('Wallet trades by outcome:\n')
    console.log('Outcome | Shares      | USDC        | Fee         | Net Shares')
    console.log('-'.repeat(75))
    tradesByOutcome.forEach(t => {
      const outcome = t.outcome_index.toString().padStart(7)
      const shares = t.shares.toFixed(2).padStart(11)
      const usdc = `$${t.usdc.toFixed(2)}`.padStart(11)
      const fee = `$${t.fee.toFixed(2)}`.padStart(11)
      const netShares = t.net_shares_dir.toFixed(2).padStart(10)
      console.log(`${outcome} | ${shares} | ${usdc} | ${fee} | ${netShares}`)
    })

    // Recompute PnL
    console.log()
    console.log('Recomputing PnL:\n')

    const recomputeResult = await clickhouse.query({
      query: `
        WITH ledger AS (
          SELECT
            sum(cash_delta_usdc) AS trade_cash,
            sum(shares_delta) AS final_shares
          FROM vw_pm_ledger_v2
          WHERE wallet_address = '${WALLET}'
            AND condition_id = '${SHORTFALL_MARKET}'
        ),
        pay AS (
          SELECT payout_numerators
          FROM pm_condition_resolutions
          WHERE lower(condition_id) = '${SHORTFALL_MARKET}'
        )
        SELECT
          l.trade_cash,
          l.final_shares,
          p.payout_numerators
        FROM ledger l
        CROSS JOIN pay p
      `,
      format: 'JSONEachRow'
    })
    const recompute = await recomputeResult.json() as Array<{
      trade_cash: number
      final_shares: number
      payout_numerators: string
    }>

    if (recompute.length > 0) {
      const r = recompute[0]
      const payouts = JSON.parse(r.payout_numerators) as number[]
      const payoutSum = payouts.reduce((sum, p) => sum + p, 0)
      const resolvedPrice = payoutSum > 0 ? payouts[winnerIndex] / payoutSum : 0

      console.log(`Trade cash: $${r.trade_cash.toFixed(2)}`)
      console.log(`Final shares: ${r.final_shares.toFixed(2)}`)
      console.log(`Resolved price: ${resolvedPrice}`)
      console.log(`Resolution cash: $${(r.final_shares * resolvedPrice).toFixed(2)}`)
      console.log(`Realized PnL: $${(r.trade_cash + r.final_shares * resolvedPrice).toFixed(2)}`)
      console.log()

      const expectedPnL = 41289.47
      const ourPnL = r.trade_cash + r.final_shares * resolvedPrice
      const gap = ourPnL - expectedPnL

      console.log(`Expected (UI): $${expectedPnL.toFixed(2)}`)
      console.log(`Our calculation: $${ourPnL.toFixed(2)}`)
      console.log(`Gap: $${gap.toFixed(2)} (${((gap/expectedPnL)*100).toFixed(1)}%)`)
    }

    // ========================================
    // C) Check for trades in older tables
    // ========================================
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 C) Check for Missing Trades in Older Tables\n')

    // Check if pm_trader_events (old table) exists and has these trades
    try {
      const oldTableCheckResult = await clickhouse.query({
        query: `
          SELECT count(*) AS count
          FROM pm_trader_events
          WHERE lower(trader_wallet) = '${WALLET}'
            AND toString(token_id) IN (${missingTokens.map(t => `'${t.token_id_dec}'`).join(', ')})
        `,
        format: 'JSONEachRow'
      })
      const oldTableCheck = await oldTableCheckResult.json() as Array<{ count: string }>

      const oldCount = parseInt(oldTableCheck[0].count)
      if (oldCount > 0) {
        console.log(`⚠️  Found ${oldCount} trades in pm_trader_events (old table)`)
        console.log('   These trades need to be migrated to pm_trader_events_v2')
      } else {
        console.log('✅ No trades found in pm_trader_events (old table)')
      }
    } catch (error) {
      console.log('ℹ️  pm_trader_events table does not exist (expected for new setup)')
    }

    // ========================================
    // D) Final Report
    // ========================================
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 FINAL REPORT\n')
    console.log('Issue 1: "More than $6.00 in March" (8e02dc...)')
    console.log(`  Token mapping: ${missingTokens.length > 0 ? '✅ EXISTS' : '❌ MISSING'}`)
    if (missingTokens.length > 0) {
      const allTrades = tradesAll ? parseInt(tradesAll[0].trades_all) : 0
      const walletTrades = tradesWallet ? parseInt(tradesWallet[0].trades_wallet) : 0
      console.log(`  Trades (all wallets): ${allTrades}`)
      console.log(`  Trades (our wallet): ${walletTrades}`)

      if (allTrades === 0) {
        console.log('  🔴 DIAGNOSIS: INGESTION GAP - no trades for these token_ids')
      } else if (walletTrades === 0) {
        console.log('  ⚠️  DIAGNOSIS: Wallet did not trade this market OR UI is different wallet')
      } else {
        console.log('  🔴 DIAGNOSIS: MAPPING/JOIN ISSUE - trades exist but not in ledger view')
      }
    }
    console.log()
    console.log('Issue 2: "Below $4.50 in May" (ee3a38...)')
    console.log(`  Token mapping: ${shortfallTokens.length > 0 ? '✅ EXISTS' : '❌ MISSING'}`)
    console.log(`  Winner outcome: ${winnerIndex}`)
    if (tradesByOutcome.length > 0) {
      console.log(`  Wallet traded ${tradesByOutcome.length} outcome(s)`)
      const tradedWinner = tradesByOutcome.find(t => t.outcome_index === winnerIndex)
      if (tradedWinner) {
        console.log(`  ✅ Wallet traded the WINNING outcome (${winnerIndex})`)
      } else {
        console.log(`  ⚠️  Wallet did NOT trade the winning outcome (traded: ${tradesByOutcome.map(t => t.outcome_index).join(', ')})`)
      }
    }
    if (recompute.length > 0) {
      const r = recompute[0]
      const payouts = JSON.parse(r.payout_numerators) as number[]
      const payoutSum = payouts.reduce((sum, p) => sum + p, 0)
      const resolvedPrice = payoutSum > 0 ? payouts[winnerIndex] / payoutSum : 0
      const ourPnL = r.trade_cash + r.final_shares * resolvedPrice

      console.log(`  Our PnL: $${ourPnL.toFixed(2)}`)
      console.log(`  Expected: $41,289.47`)
      console.log(`  Gap: $${(ourPnL - 41289.47).toFixed(2)}`)

      if (Math.abs(ourPnL - 26187.88) < 0.01) {
        console.log('  ✅ Recomputation matches our view calculation')
      } else {
        console.log('  ⚠️  Recomputation differs from view - view might have issue')
      }
    }

    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

investigateSpecificMarkets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
