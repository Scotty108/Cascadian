/**
 * PnL Engine V2 - Incorporating CTF Events
 *
 * Builds V2 views side-by-side with V1:
 * 1. vw_pm_ctf_ledger - Normalized CTF events
 * 2. vw_pm_ledger_v2 - UNION of trades + CTF
 * 3. vw_pm_realized_pnl_v2 - Same logic as V1 but with ledger_v2
 *
 * NOTE: pm_ctf_events only contains PayoutRedemption events, no SPLIT/MERGE
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createV2Views() {
  console.log('🔧 PnL Engine V2 - Creating Views with CTF Events\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Create vw_pm_ctf_ledger
    console.log('\n📊 Step 1: Creating vw_pm_ctf_ledger\n')
    console.log('Normalizing PayoutRedemption events to ledger format...\n')

    const createCTFLedgerSQL = `
      CREATE OR REPLACE VIEW vw_pm_ctf_ledger AS
      SELECT
          lower(user_address) AS wallet_address,
          lower(condition_id) AS condition_id,

          -- Parse partition_index_sets to get outcome_index
          -- For now, use 0 as default (most redemptions are single outcome)
          -- TODO: Parse JSON array if needed for multi-outcome
          0 AS outcome_index,

          -- PayoutRedemption: redeeming winning shares for payout
          -- shares_delta = -amount (burning shares)
          -- cash_delta = +payout (receiving money)
          -(toFloat64OrZero(amount_or_payout) / 1e6) AS shares_delta,
          toFloat64OrZero(amount_or_payout) / 1e6 AS cash_delta_usdc,

          0 AS fee_usdc,
          event_type,
          event_timestamp AS block_time,
          block_number,
          tx_hash,
          'CTF_' || event_type AS source

      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_timestamp > toDateTime('1970-01-01 01:00:00')  -- Exclude epoch defaults
    `

    await clickhouse.command({ query: createCTFLedgerSQL })
    console.log('   ✅ vw_pm_ctf_ledger created')

    // Verify CTF ledger
    const ctfCountResult = await clickhouse.query({
      query: 'SELECT count() as total FROM vw_pm_ctf_ledger',
      format: 'JSONEachRow'
    })
    const ctfCount = await ctfCountResult.json() as Array<{ total: string }>
    console.log(`   📈 Total CTF ledger rows: ${parseInt(ctfCount[0].total).toLocaleString()}`)

    // Step 2: Create vw_pm_ledger_v2 (UNION trades + CTF)
    console.log('\n📊 Step 2: Creating vw_pm_ledger_v2 (trades + CTF)\n')

    const createLedgerV2SQL = `
      CREATE OR REPLACE VIEW vw_pm_ledger_v2 AS
      SELECT
          wallet_address,
          condition_id,
          outcome_index,
          shares_delta,
          cash_delta_usdc,
          fee_usdc,
          block_time,
          toUInt64(block_number) AS block_number,
          tx_hash,
          'TRADE' AS source
      FROM vw_pm_ledger

      UNION ALL

      SELECT
          wallet_address,
          condition_id,
          outcome_index,
          shares_delta,
          cash_delta_usdc,
          fee_usdc,
          block_time,
          toUInt64(block_number) AS block_number,
          tx_hash,
          source
      FROM vw_pm_ctf_ledger
    `

    await clickhouse.command({ query: createLedgerV2SQL })
    console.log('   ✅ vw_pm_ledger_v2 created')

    // Verify ledger V2
    const ledgerV2CountResult = await clickhouse.query({
      query: `
        SELECT
          source,
          count() as row_count
        FROM vw_pm_ledger_v2
        GROUP BY source
      `,
      format: 'JSONEachRow'
    })
    const ledgerV2Count = await ledgerV2CountResult.json() as Array<{
      source: string
      row_count: string
    }>

    console.log('\n   Source breakdown:')
    console.log('   Source              | Rows')
    console.log('   ' + '-'.repeat(35))
    ledgerV2Count.forEach(row => {
      const source = row.source.padEnd(19)
      const count = parseInt(row.row_count).toLocaleString().padStart(10)
      console.log(`   ${source} | ${count}`)
    })

    // Step 3: Create vw_pm_realized_pnl_v2
    console.log('\n📊 Step 3: Creating vw_pm_realized_pnl_v2\n')
    console.log('Using same logic as V1 but with ledger_v2...\n')

    const createPnLV2SQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v2 AS
      WITH trade_aggregates AS (
          SELECT
              wallet_address,
              condition_id,
              outcome_index,
              sum(cash_delta_usdc) AS trade_cash,
              sum(shares_delta) AS final_shares,
              sum(fee_usdc) AS total_fees,
              count() AS trade_count,
              min(block_time) AS first_trade_time,
              max(block_time) AS last_trade_time
          FROM vw_pm_ledger_v2
          GROUP BY wallet_address, condition_id, outcome_index
      )
      SELECT
          t.wallet_address,
          t.condition_id,
          t.outcome_index,
          t.trade_cash,
          t.final_shares,
          t.total_fees,
          t.trade_count,
          t.first_trade_time,
          t.last_trade_time,
          r.resolved_price,
          r.resolution_time,

          -- Calculate resolution payout (NULL-safe)
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.final_shares * r.resolved_price
              ELSE 0
          END AS resolution_cash,

          -- Calculate realized PnL (NULL-safe)
          CASE
              WHEN r.resolved_price IS NOT NULL THEN t.trade_cash + (t.final_shares * r.resolved_price)
              ELSE NULL
          END AS realized_pnl,

          -- Status flags
          r.resolved_price IS NOT NULL AS is_resolved,
          r.resolved_price > 0 AS is_winner

      FROM trade_aggregates t
      LEFT JOIN vw_pm_resolution_prices r
          ON t.condition_id = r.condition_id
         AND t.outcome_index = r.outcome_index
    `

    await clickhouse.command({ query: createPnLV2SQL })
    console.log('   ✅ vw_pm_realized_pnl_v2 created')

    // Verify V2
    const v2StatusResult = await clickhouse.query({
      query: `
        SELECT
          is_resolved,
          count() as position_count
        FROM vw_pm_realized_pnl_v2
        GROUP BY is_resolved
      `,
      format: 'JSONEachRow'
    })
    const v2Status = await v2StatusResult.json() as Array<{
      is_resolved: number
      position_count: string
    }>

    console.log('\n   Resolution Status:')
    console.log('   Status      | Positions')
    console.log('   ' + '-'.repeat(35))
    v2Status.forEach(row => {
      const status = (row.is_resolved === 1 ? 'Resolved' : 'Unresolved').padEnd(11)
      const positions = parseInt(row.position_count).toLocaleString().padStart(13)
      console.log(`   ${status} | ${positions}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ V2 VIEWS CREATED\n')
    console.log('Views created:')
    console.log('  - vw_pm_ctf_ledger (CTF events normalized)')
    console.log('  - vw_pm_ledger_v2 (trades + CTF)')
    console.log('  - vw_pm_realized_pnl_v2 (PnL with CTF)')
    console.log('\nV1 views remain intact for comparison')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

createV2Views()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
