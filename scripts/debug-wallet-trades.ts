#!/usr/bin/env npx tsx
/**
 * DEBUG: Get detailed trade data for wallet 0x961b5ad4c66ec18d073c216054ddd42523336a1d
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function debug() {
  console.log('='.repeat(120))
  console.log('DEBUG: Wallet Trade Details')
  console.log('Wallet: 0x961b5ad4c66ec18d073c216054ddd42523336a1d')
  console.log('='.repeat(120))

  try {
    const query = `
      SELECT
        t.transaction_hash,
        t.wallet_address,
        t.condition_id,
        t.outcome_index,
        t.shares,
        t.entry_price,
        t.fee_usd,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_outcome,
        CASE
          WHEN t.outcome_index = r.winning_index THEN 'WINNER'
          ELSE 'LOSER'
        END as trade_result,
        CAST(t.shares AS Float64) as shares_calc,
        CAST(r.payout_numerators[t.outcome_index] AS Float64) as payout_val,
        CAST(r.payout_denominator AS Float64) as payout_denom,
        CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64) as cost_basis
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.wallet_address = '0x961b5ad4c66ec18d073c216054ddd42523336a1d'
        AND r.winning_index IS NOT NULL
      LIMIT 5;
    `

    const result = await clickhouse.query({
      query: query,
      format: 'JSONEachRow'
    })

    const rows = await result.json()

    console.log(`\n📊 Found ${rows.length} resolved trades for this wallet\n`)

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      console.log(`\n${'='.repeat(120)}`)
      console.log(`TRADE ${i + 1}`)
      console.log(`${'='.repeat(120)}`)
      console.log(`Transaction Hash:       ${row.transaction_hash}`)
      console.log(`Condition ID:           ${row.condition_id}`)
      console.log(`Outcome Index (trader): ${row.outcome_index}`)
      console.log(`Winning Index:          ${row.winning_index}`)
      console.log(`Trade Result:           ${row.trade_result}`)
      console.log(`\nShares:                 ${row.shares}`)
      console.log(`Entry Price:            $${row.entry_price}`)
      console.log(`Fee:                    $${row.fee_usd}`)
      console.log(`\nCost Basis:             $${row.cost_basis?.toFixed(2)}`)
      console.log(`\nPayout Numerators:      ${row.payout_numerators}`)
      console.log(`Payout Denominator:     ${row.payout_denominator}`)
      console.log(`Payout at index [${row.outcome_index}]: ${row.payout_val}`)
      
      // Manual calculation
      if (row.trade_result === 'WINNER') {
        const settlement = row.shares_calc * (row.payout_val / row.payout_denom)
        const pnl = settlement - row.cost_basis - (row.fee_usd || 0)
        console.log(`\n✅ WINNER`)
        console.log(`   Settlement: ${row.shares_calc} × (${row.payout_val} / ${row.payout_denom}) = $${settlement.toFixed(2)}`)
        console.log(`   P&L: $${settlement.toFixed(2)} - $${row.cost_basis.toFixed(2)} - $${(row.fee_usd || 0).toFixed(2)} = $${pnl.toFixed(2)}`)
      } else {
        const loss = -(row.cost_basis + (row.fee_usd || 0))
        console.log(`\n❌ LOSER`)
        console.log(`   Loss: -$${row.cost_basis.toFixed(2)} - $${(row.fee_usd || 0).toFixed(2)} = $${loss.toFixed(2)}`)
      }
    }

    console.log(`\n${'='.repeat(120)}`)
    console.log('Sum these individual P&Ls to get total wallet P&L\n')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

debug()
