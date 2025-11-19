#!/usr/bin/env npx tsx

/**
 * XCN Realized P&L with Settlements
 *
 * Calculate trade P&L + settlement payouts for resolved markets using real payout data
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

// CLI arguments
const args = process.argv.slice(2)
const payoutSourceArg = args.find(a => a.startsWith('--payout-source='))
const PAYOUT_SOURCE = payoutSourceArg ? payoutSourceArg.split('=')[1] : 'market_resolutions_final'

const XCN_BASE = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('XCN REALIZED P&L WITH SETTLEMENTS')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Wallet: ${XCN_BASE}`)
  console.log(`Payout Source: ${PAYOUT_SOURCE}`)
  console.log()

  // ========================================================================
  // QUERY 1: Realized P&L on resolved markets with settlement payouts
  // ========================================================================
  console.log('QUERY 1: REALIZED P&L (resolved markets + settlements)')
  console.log('─'.repeat(80))
  console.log()

  const realizedQuery = `
    WITH trades_by_market AS (
      SELECT
        condition_id_norm_v3 AS cid,
        outcome_index_v3 AS outcome_idx,
        sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
        sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
        shares_buy - shares_sell AS net_shares,
        sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
        sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCN_BASE}')
        AND condition_id_norm_v3 != ''
      GROUP BY cid, outcome_idx
    ),
    with_resolutions AS (
      SELECT
        t.*,
        r.winning_outcome,
        r.winning_index,
        r.resolved_at,
        r.payout_numerators,
        r.payout_denominator,
        COALESCE(r.winning_outcome, r.winning_index) AS winning_outcome_norm,
        (length(r.payout_numerators) > 0 AND toFloat64(r.payout_denominator) > 0) AS has_payout,
        -- Real payout calculation with guard against NaN/array bounds/zero denom
        if(
          r.payout_denominator = 0
            OR r.payout_denominator IS NULL
            OR length(r.payout_numerators) < t.outcome_idx + 1,
          0,
          toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
        ) AS payout_per_share,
        t.net_shares * payout_per_share AS settlement_value
      FROM trades_by_market t
      LEFT JOIN ${PAYOUT_SOURCE} r
        ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
    ),
    resolved_only AS (
      SELECT * FROM with_resolutions WHERE winning_outcome_norm IS NOT NULL OR has_payout
    ),
    unresolved AS (
      SELECT * FROM with_resolutions WHERE NOT (winning_outcome_norm IS NOT NULL OR has_payout)
    )
    SELECT
      -- Resolved markets
      (SELECT COALESCE(sum(proceeds_sell - cost_buy + settlement_value), 0) FROM resolved_only) AS realized_pnl,
      (SELECT COALESCE(sum(cost_buy + proceeds_sell), 0) FROM resolved_only) AS resolved_volume,
      (SELECT count() FROM resolved_only) AS resolved_positions,
      (SELECT COALESCE(sum(settlement_value), 0) FROM resolved_only) AS total_settlement_value,

      -- Unrealized (open) markets
      (SELECT COALESCE(sum(proceeds_sell - cost_buy), 0) FROM unresolved) AS unrealized_trade_pnl,
      (SELECT COALESCE(sum(cost_buy + proceeds_sell), 0) FROM unresolved) AS unrealized_volume,
      (SELECT count() FROM unresolved) AS open_positions,

      -- Totals
      (SELECT count() FROM trades_by_market) AS total_positions
  `

  const realizedResult = await clickhouse.query({
    query: realizedQuery,
    format: 'JSONEachRow',
  })
  const realizedData = await realizedResult.json<any>()
  const r = realizedData[0]

  console.log('RESOLVED MARKETS (with settlements):')
  console.log(`  Realized P&L:        $${parseFloat(r.realized_pnl || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Trade Volume:        $${parseFloat(r.resolved_volume || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Settlement Value:    $${parseFloat(r.total_settlement_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Resolved Positions:  ${parseInt(r.resolved_positions || 0).toLocaleString('en-US')}`)
  console.log()

  console.log('UNREALIZED (Open Markets):')
  console.log(`  Trade P&L:           $${parseFloat(r.unrealized_trade_pnl || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Trade Volume:        $${parseFloat(r.unrealized_volume || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Open Positions:      ${parseInt(r.open_positions || 0).toLocaleString('en-US')}`)
  console.log()

  console.log('TOTAL:')
  console.log(`  Total Positions:     ${parseInt(r.total_positions || 0).toLocaleString('en-US')}`)
  console.log(`  Net P&L:             $${(parseFloat(r.realized_pnl || 0) + parseFloat(r.unrealized_trade_pnl || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log()

  // ========================================================================
  // Sample resolved positions
  // ========================================================================
  console.log('SAMPLE RESOLVED POSITIONS (top 10 by settlement value):')
  console.log('─'.repeat(80))
  console.log()

  const sampleQuery = `
    WITH trades_by_market AS (
      SELECT
        condition_id_norm_v3 AS cid,
        outcome_index_v3 AS outcome_idx,
        sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
        sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
        shares_buy - shares_sell AS net_shares,
        sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
        sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCN_BASE}')
        AND condition_id_norm_v3 != ''
      GROUP BY cid, outcome_idx
    )
    SELECT
      substring(t.cid, 1, 16) || '...' AS cid_short,
      t.outcome_idx,
      COALESCE(r.winning_outcome, r.winning_index) AS winning_outcome_norm,
      t.net_shares,
      t.cost_buy,
      t.proceeds_sell,
      COALESCE(
        toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator),
        0
      ) AS payout_per_share,
      t.net_shares * payout_per_share AS settlement_value,
      t.proceeds_sell - t.cost_buy + settlement_value AS total_pnl
    FROM trades_by_market t
    INNER JOIN ${PAYOUT_SOURCE} r
      ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
    ORDER BY abs(settlement_value) DESC
    LIMIT 10
  `

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow',
  })
  const sampleData = await sampleResult.json<any>()

  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.cid_short} (outcome ${row.outcome_idx})`)
    console.log(`   Winner: ${row.winning_outcome}`)
    console.log(`   Net Shares: ${parseFloat(row.net_shares).toFixed(2)}`)
    console.log(`   Cost: $${parseFloat(row.cost_buy).toFixed(2)} | Proceeds: $${parseFloat(row.proceeds_sell).toFixed(2)}`)
    console.log(`   Settlement: $${parseFloat(row.settlement_value).toFixed(2)} @ $${parseFloat(row.payout_per_share).toFixed(2)}/share`)
    console.log(`   Total P&L: $${parseFloat(row.total_pnl).toFixed(2)}\n`)
  })

  // ========================================================================
  // Comparison to trade-only P&L
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('COMPARISON')
  console.log('════════════════════════════════════════════════════════════════════\n')

  const tradeOnlyPnL = parseFloat(r.realized_pnl || 0) - parseFloat(r.total_settlement_value || 0) + parseFloat(r.unrealized_trade_pnl || 0)
  const netPnL = parseFloat(r.realized_pnl || 0) + parseFloat(r.unrealized_trade_pnl || 0)

  console.log('Previous (trade-only):       $-20,212.59')
  console.log(`Trade-only (recalculated):   $${tradeOnlyPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`With settlements (Net P&L):  $${netPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`Settlement impact:           $${parseFloat(r.total_settlement_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
