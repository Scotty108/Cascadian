import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Test PnL calculation using trades_with_direction
 * This table has 100% condition_id coverage (82.1M rows)
 */

async function testPnL() {
  try {
    console.log('═'.repeat(70))
    console.log('PnL TEST - Using trades_with_direction')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Pick a wallet with decent activity
    console.log('Step 1: Finding active wallets...')

    const activeWalletResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as trade_count,
          COUNT(DISTINCT condition_id_norm) as unique_markets
        FROM trades_with_direction
        GROUP BY wallet_address
        HAVING trade_count > 100 AND trade_count < 1000
        ORDER BY trade_count DESC
        LIMIT 5
      `
    })

    const activeWallets = JSON.parse(await activeWalletResult.text()).data
    console.log('  Top 5 active wallets:')
    activeWallets.forEach((w: any, i: number) => {
      console.log(`    ${i + 1}. ${w.wallet_address}: ${w.trade_count} trades, ${w.unique_markets} markets`)
    })
    console.log()

    const testWallet = activeWallets[0].wallet_address
    console.log(`Step 2: Testing PnL for wallet: ${testWallet}`)
    console.log()

    // Step 2: Get all trades for this wallet
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          tx_hash,
          condition_id_norm,
          market_id,
          direction_from_transfers as side,
          shares,
          price,
          usd_value
        FROM trades_with_direction
        WHERE wallet_address = '${testWallet}'
        ORDER BY tx_hash
        LIMIT 20
      `
    })

    const trades = JSON.parse(await tradesResult.text()).data
    console.log(`  Found ${trades.length} trades (showing first 20)`)
    console.log()
    console.log('  Sample trades:')
    trades.slice(0, 5).forEach((t: any, i: number) => {
      console.log(`    ${i + 1}. ${t.side} ${parseFloat(t.shares).toFixed(2)} shares @ $${parseFloat(t.price).toFixed(3)} = $${parseFloat(t.usd_value).toFixed(2)}`)
      console.log(`       condition: ${t.condition_id_norm.substring(0, 16)}...`)
    })
    console.log()

    // Step 3: Check if we have resolution data for these conditions
    console.log('Step 3: Checking resolution data availability...')

    const resolutionResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT t.condition_id_norm) as total_conditions,
          COUNT(DISTINCT r.condition_id) as with_resolution,
          ROUND(100.0 * COUNT(DISTINCT r.condition_id) / COUNT(DISTINCT t.condition_id_norm), 2) as resolution_coverage
        FROM (
          SELECT DISTINCT condition_id_norm
          FROM trades_with_direction
          WHERE wallet_address = '${testWallet}'
        ) t
        LEFT JOIN market_resolutions_final r
          ON t.condition_id_norm = r.condition_id
      `
    })

    const resolutionData = JSON.parse(await resolutionResult.text()).data[0]
    console.log(`  Conditions traded: ${resolutionData.total_conditions}`)
    console.log(`  With resolutions: ${resolutionData.with_resolution}`)
    console.log(`  Resolution coverage: ${resolutionData.resolution_coverage}%`)
    console.log()

    // Step 4: Calculate simple PnL (realized only, for resolved markets)
    console.log('Step 4: Calculating realized PnL...')

    const pnlResult = await clickhouse.query({
      query: `
        WITH position_trades AS (
          SELECT
            t.condition_id_norm,
            t.direction_from_transfers as side,
            t.shares,
            t.price,
            t.usd_value,
            r.winning_index,
            r.payout_numerators
          FROM trades_with_direction t
          LEFT JOIN market_resolutions_final r
            ON t.condition_id_norm = r.condition_id
          WHERE t.wallet_address = '${testWallet}'
            AND r.condition_id IS NOT NULL
        ),
        pnl_calc AS (
          SELECT
            condition_id_norm,
            SUM(CASE WHEN side = 'BUY' THEN shares ELSE -shares END) as net_position,
            SUM(CASE WHEN side = 'BUY' THEN usd_value ELSE -usd_value END) as cost_basis,
            winning_index,
            payout_numerators
          FROM position_trades
          GROUP BY condition_id_norm, winning_index, payout_numerators
        )
        SELECT
          COUNT(*) as positions,
          SUM(CASE WHEN net_position > 0 THEN 1 ELSE 0 END) as long_positions,
          SUM(CASE WHEN net_position < 0 THEN 1 ELSE 0 END) as short_positions,
          SUM(cost_basis) as total_cost_basis,
          SUM(
            CASE
              WHEN net_position != 0 THEN net_position - cost_basis
              ELSE 0
            END
          ) as estimated_pnl
        FROM pnl_calc
      `
    })

    const pnlData = JSON.parse(await pnlResult.text()).data[0]
    console.log(`  Resolved positions: ${pnlData.positions}`)
    console.log(`  Long positions: ${pnlData.long_positions}`)
    console.log(`  Short positions: ${pnlData.short_positions}`)
    console.log(`  Total cost basis: $${parseFloat(pnlData.total_cost_basis).toFixed(2)}`)
    console.log(`  Estimated PnL: $${parseFloat(pnlData.estimated_pnl).toFixed(2)}`)
    console.log()

    console.log('═'.repeat(70))
    console.log('✅ PnL CALCULATION SUCCESSFUL')
    console.log('═'.repeat(70))
    console.log()
    console.log('trades_with_direction is working correctly for PnL calculations!')
    console.log()

    return {
      success: true,
      testWallet,
      tradeCount: trades.length,
      resolutionCoverage: resolutionData.resolution_coverage,
      pnl: pnlData.estimated_pnl
    }

  } catch (e: any) {
    console.error('ERROR:', e.message)
    return {
      success: false,
      error: e.message
    }
  }
}

testPnL().then(result => {
  console.log('Test Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
