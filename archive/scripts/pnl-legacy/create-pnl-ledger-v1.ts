/**
 * PnL Engine V1 - Step 1: Create Canonical Trade Ledger
 *
 * Creates vw_pm_ledger VIEW that normalizes trades from pm_trader_events_v2
 * and runs sanity checks to validate signs, scaling, and joins.
 *
 * Per PNL_ENGINE_CANONICAL_SPEC.md:
 * - Uses pm_trader_events_v2 (raw trade events)
 * - Joins pm_token_to_condition_map_v3 (token → condition mapping)
 * - Scales micro-USDC and micro-shares by 1e6
 * - Calculates signed deltas from wallet perspective
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createLedgerView() {
  console.log('🏗️  PnL Engine V1 - Step 1: Creating Canonical Trade Ledger\n')
  console.log('=' .repeat(80))

  try {
    // Step 1: Create the ledger view
    console.log('\n📊 Step 1: Creating vw_pm_ledger VIEW...')

    const createViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_ledger AS
      SELECT
          lower(t.trader_wallet)          AS wallet_address,
          m.condition_id,
          m.outcome_index,
          toString(t.token_id)            AS token_id,
          t.trade_time                    AS block_time,
          t.block_number,
          t.transaction_hash              AS tx_hash,
          lower(t.role)                   AS role,
          lower(t.side)                   AS side_raw,
          t.token_amount / 1e6            AS shares,        -- scaled
          t.usdc_amount  / 1e6            AS usdc,          -- scaled
          t.fee_amount   / 1e6            AS fee,           -- scaled
          /* signed share change from wallet perspective */
          CASE
              WHEN lower(t.side) = 'buy'  THEN  t.token_amount / 1e6
              WHEN lower(t.side) = 'sell' THEN -t.token_amount / 1e6
          END AS shares_delta,
          /* net cash change (positive = USDC in, negative = USDC out) */
          CASE
              WHEN lower(t.side) = 'buy'  THEN - (t.usdc_amount + t.fee_amount) / 1e6
              WHEN lower(t.side) = 'sell' THEN   (t.usdc_amount - t.fee_amount) / 1e6
          END AS cash_delta_usdc,
          t.fee_amount / 1e6              AS fee_usdc,
          'TRADE'                         AS event_type
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v3 m
          ON toString(t.token_id) = toString(m.token_id_dec)
    `

    await clickhouse.command({ query: createViewSQL })
    console.log('   ✅ View created successfully')

    // Verify view exists
    const viewCheck = await clickhouse.query({
      query: "SELECT count() as total FROM vw_pm_ledger LIMIT 1",
      format: 'JSONEachRow',
    })
    const viewCount = await viewCheck.json() as Array<{ total: string }>
    console.log(`   📈 Total ledger rows: ${parseInt(viewCount[0].total).toLocaleString()}`)

    console.log('\n' + '='.repeat(80))
    console.log('🔍 SANITY CHECKS\n')

    // Sanity Check 1: Top markets by trade count
    console.log('📊 Sanity Check 1: Top 20 Markets by Trade Count\n')
    const topMarketsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          count() AS n_rows
        FROM vw_pm_ledger
        GROUP BY condition_id
        ORDER BY n_rows DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    })
    const topMarkets = await topMarketsResult.json() as Array<{ condition_id: string; n_rows: string }>

    console.log('   Rank | Rows        | Condition ID')
    console.log('   ' + '-'.repeat(70))
    topMarkets.forEach((market, i) => {
      const rowCount = parseInt(market.n_rows).toLocaleString().padStart(11)
      console.log(`   ${(i + 1).toString().padStart(4)} | ${rowCount} | ${market.condition_id}`)
    })

    // Store top condition_id for next checks
    const topConditionId = topMarkets[0]?.condition_id

    console.log('\n' + '='.repeat(80))
    console.log(`📊 Sanity Check 2: Inspect Top Market (${topConditionId?.slice(0, 16)}...)\n`)

    if (topConditionId) {
      // Get a sample wallet from this market
      const walletSampleResult = await clickhouse.query({
        query: `
          SELECT
            wallet_address,
            count() as trade_count,
            sum(shares_delta) as net_shares,
            sum(cash_delta_usdc) as net_cash
          FROM vw_pm_ledger
          WHERE condition_id = '${topConditionId}'
          GROUP BY wallet_address
          ORDER BY trade_count DESC
          LIMIT 1
        `,
        format: 'JSONEachRow',
      })
      const walletSample = await walletSampleResult.json() as Array<{
        wallet_address: string
        trade_count: string
        net_shares: number
        net_cash: number
      }>

      if (walletSample.length > 0) {
        const sampleWallet = walletSample[0].wallet_address
        console.log(`   Sample wallet: ${sampleWallet}`)
        console.log(`   Total trades:  ${walletSample[0].trade_count}`)
        console.log(`   Net shares:    ${walletSample[0].net_shares.toFixed(6)}`)
        console.log(`   Net cash:      $${walletSample[0].net_cash.toFixed(2)} USDC\n`)

        // Show first 10 trades for this wallet
        console.log('   First 10 trades for this wallet:\n')
        const tradesResult = await clickhouse.query({
          query: `
            SELECT
              block_time,
              side_raw,
              shares,
              usdc,
              fee,
              shares_delta,
              cash_delta_usdc
            FROM vw_pm_ledger
            WHERE condition_id = '${topConditionId}'
              AND wallet_address = '${sampleWallet}'
            ORDER BY block_time, tx_hash
            LIMIT 10
          `,
          format: 'JSONEachRow',
        })
        const trades = await tradesResult.json() as Array<{
          block_time: string
          side_raw: string
          shares: number
          usdc: number
          fee: number
          shares_delta: number
          cash_delta_usdc: number
        }>

        console.log('   Time                | Side | Shares      | USDC        | Fee      | Δ Shares    | Δ Cash')
        console.log('   ' + '-'.repeat(95))
        trades.forEach(trade => {
          const time = new Date(trade.block_time).toISOString().slice(0, 19).replace('T', ' ')
          const side = trade.side_raw.padEnd(4)
          const shares = trade.shares.toFixed(2).padStart(11)
          const usdc = trade.usdc.toFixed(2).padStart(11)
          const fee = trade.fee.toFixed(2).padStart(8)
          const sharesDelta = trade.shares_delta.toFixed(2).padStart(11)
          const cashDelta = trade.cash_delta_usdc.toFixed(2).padStart(10)
          console.log(`   ${time} | ${side} | ${shares} | ${usdc} | ${fee} | ${sharesDelta} | ${cashDelta}`)
        })
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('📊 Sanity Check 3: Balance Close-Out Analysis\n')

    if (topConditionId) {
      console.log(`   Analyzing wallets in market: ${topConditionId.slice(0, 16)}...`)
      console.log('   (Showing wallets with largest |net_shares| - expect near-zero for closed positions)\n')

      const balanceResult = await clickhouse.query({
        query: `
          SELECT
            wallet_address,
            token_id,
            sum(shares_delta)    AS net_shares,
            sum(cash_delta_usdc) AS net_cash,
            count()              AS trade_count
          FROM vw_pm_ledger
          WHERE condition_id = '${topConditionId}'
          GROUP BY wallet_address, token_id
          ORDER BY abs(net_shares) DESC
          LIMIT 20
        `,
        format: 'JSONEachRow',
      })
      const balances = await balanceResult.json() as Array<{
        wallet_address: string
        token_id: string
        net_shares: number
        net_cash: number
        trade_count: string
      }>

      console.log('   Wallet Address                             | Token ID    | Trades | Net Shares  | Net Cash (USDC)')
      console.log('   ' + '-'.repeat(105))
      balances.forEach(balance => {
        const wallet = balance.wallet_address.slice(0, 42).padEnd(42)
        const tokenId = balance.token_id.slice(0, 11).padEnd(11)
        const trades = balance.trade_count.toString().padStart(6)
        const netShares = balance.net_shares.toFixed(2).padStart(11)
        const netCash = balance.net_cash.toFixed(2).padStart(15)
        console.log(`   ${wallet} | ${tokenId} | ${trades} | ${netShares} | ${netCash}`)
      })

      // Summary stats
      console.log('\n   Summary Statistics:')
      const statsResult = await clickhouse.query({
        query: `
          SELECT
            count(DISTINCT wallet_address) as unique_wallets,
            count(DISTINCT token_id) as unique_tokens,
            sum(abs(net_shares) < 0.01) as fully_closed_count,
            count() as total_positions
          FROM (
            SELECT
              wallet_address,
              token_id,
              sum(shares_delta) AS net_shares
            FROM vw_pm_ledger
            WHERE condition_id = '${topConditionId}'
            GROUP BY wallet_address, token_id
          )
        `,
        format: 'JSONEachRow',
      })
      const stats = await statsResult.json() as Array<{
        unique_wallets: string
        unique_tokens: string
        fully_closed_count: string
        total_positions: string
      }>

      if (stats.length > 0) {
        const s = stats[0]
        const totalPos = parseInt(s.total_positions)
        const closedPos = parseInt(s.fully_closed_count)
        const closedPct = ((closedPos / totalPos) * 100).toFixed(1)

        console.log(`   - Unique wallets:     ${parseInt(s.unique_wallets).toLocaleString()}`)
        console.log(`   - Unique tokens:      ${parseInt(s.unique_tokens).toLocaleString()}`)
        console.log(`   - Total positions:    ${totalPos.toLocaleString()}`)
        console.log(`   - Fully closed:       ${closedPos.toLocaleString()} (${closedPct}%)`)
        console.log(`   - Open positions:     ${(totalPos - closedPos).toLocaleString()}`)
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ Ledger View Creation Complete!')
    console.log('\n📋 Next Steps:')
    console.log('   1. Review the sanity check results above')
    console.log('   2. Verify that:')
    console.log('      - Buy trades have positive shares_delta, negative cash_delta')
    console.log('      - Sell trades have negative shares_delta, positive cash_delta')
    console.log('      - Net shares ≈ 0 for wallets that fully closed positions')
    console.log('      - Cash deltas include fees (takers pay more)')
    console.log('   3. If validation passes, proceed to Step 2: Add resolution events')
    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the script
createLedgerView()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
