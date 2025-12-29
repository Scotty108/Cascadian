// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx

/**
 * Calibration Wallet Diagnostic: 0xf29bb8e0712075041e87e8605b69833ef738dd4c
 *
 * Purpose: Build PnL from raw fills (NOT pm_user_positions) and compare to:
 * - pm_user_positions.realized_pnl: +$28.8M
 * - Analytics site: -$10M
 *
 * Following GPT's "cash ledger" approach:
 * - Track shares_held, cash_spent, cash_received per (condition_id, outcome_index)
 * - At resolution: winning outcome gets shares_held * $1 credited
 * - PnL = cash_received + resolution_credit - cash_spent - fees
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const WALLET = '0xf29bb8e0712075041e87e8605b69833ef738dd4c'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function runQuery(name: string, query: string) {
  console.log(`
${'='.repeat(70)}`)
  console.log(name)
  console.log('='.repeat(70))
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 120 }
    })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('
🔬 CALIBRATION WALLET DIAGNOSTIC')
  console.log(`Wallet: ${WALLET}`)
  console.log('
Target: Match analytics site PnL (~-$10M)')
  console.log('Current pm_user_positions: +$28.8M (MISMATCH)')

  // 1. Check what we have for this wallet in pm_user_positions
  await runQuery('1. pm_user_positions DATA FOR THIS WALLET',
    `SELECT
      proxy_wallet,
      sum(realized_pnl) / 1e6 as total_realized_pnl,
      sum(unrealized_pnl) / 1e6 as total_unrealized_pnl,
      sum(total_bought) / 1e6 as total_bought,
      sum(total_sold) / 1e6 as total_sold,
      count() as positions,
      countIf(is_deleted = 0) as active_positions,
      countIf(is_deleted = 1) as deleted_positions
    FROM pm_user_positions
    WHERE proxy_wallet = '${WALLET}'
    GROUP BY proxy_wallet`)

  // 2. Check raw trades for this wallet
  await runQuery('2. RAW TRADES SUMMARY (pm_trader_events_v2)',
    `SELECT
      count() as total_trades,
      countIf(lower(side) = 'buy') as buy_trades,
      countIf(lower(side) = 'sell') as sell_trades,
      sumIf(usdc_amount, lower(side) = 'buy') / 1e6 as total_bought_usdc,
      sumIf(usdc_amount, lower(side) = 'sell') / 1e6 as total_sold_usdc,
      sum(fee_amount) / 1e6 as total_fees,
      sumIf(token_amount, lower(side) = 'buy') / 1e6 as total_shares_bought,
      sumIf(token_amount, lower(side) = 'sell') / 1e6 as total_shares_sold,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0`)

  // 3. Sample trades to verify data format
  await runQuery('3. SAMPLE TRADES (5)',
    `SELECT
      event_id,
      side,
      token_id,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as shares,
      fee_amount / 1e6 as fee,
      trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    ORDER BY trade_time DESC
    LIMIT 5`)

  // 4. Check how many tokens map to conditions
  await runQuery('4. TOKEN->CONDITION MAPPING COVERAGE',
    `SELECT
      count(DISTINCT t.token_id) as unique_tokens,
      countIf(m.condition_id IS NOT NULL) as tokens_with_mapping,
      countIf(m.condition_id IS NULL) as tokens_unmapped
    FROM (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ) t
    LEFT JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id`)

  // 5. Build cash ledger PnL per position
  await runQuery('5. CASH LEDGER PnL (TOP 10 by absolute PnL)',
    `SELECT
      m.condition_id,
      m.outcome_index,
      any(md.question) as question,
      -- Cash flows
      sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1e6 as cash_spent,
      sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1e6 as cash_received,
      sum(t.fee_amount) / 1e6 as fees_paid,
      -- Share tracking
      sumIf(t.token_amount, lower(t.side) = 'buy') / 1e6 as shares_bought,
      sumIf(t.token_amount, lower(t.side) = 'sell') / 1e6 as shares_sold,
      (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6 as net_shares,
      -- Resolution
      any(r.payout_numerators) as payout_nums,
      any(r.payout_denominator) as payout_denom,
      IF(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
      -- Payout calculation (winning outcome pays $1/share)
      CASE
        WHEN any(r.condition_id) IS NOT NULL THEN
          JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1)
        ELSE 0
      END as outcome_won,
      -- Cash ledger PnL
      -- trading_pnl = cash_received - cash_spent - fees
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6 as trading_pnl,
      -- resolution_credit = net_shares * $1 if won
      CASE
        WHEN any(r.condition_id) IS NOT NULL
             AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
        THEN greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
        ELSE 0
      END as resolution_credit,
      -- total_pnl = trading_pnl + resolution_credit
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6
      + CASE
          WHEN any(r.condition_id) IS NOT NULL
               AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
          THEN greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
          ELSE 0
        END as total_pnl,
      count() as trades
    FROM pm_trader_events_v2 t
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions r ON r.condition_id = m.condition_id
    WHERE t.trader_wallet = '${WALLET}'
      AND t.is_deleted = 0
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY abs(total_pnl) DESC
    LIMIT 10`)

  // 6. Aggregate to wallet-level PnL
  await runQuery('6. WALLET-LEVEL CASH LEDGER PnL',
    `SELECT
      '${WALLET}' as wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(cash_spent), 2) as total_cash_spent,
      round(sum(cash_received), 2) as total_cash_received,
      round(sum(fees_paid), 2) as total_fees,
      round(sum(trading_pnl), 2) as total_trading_pnl,
      round(sum(resolution_credit), 2) as total_resolution_credit,
      round(sum(total_pnl), 2) as total_pnl
    FROM (
      SELECT
        m.condition_id,
        m.outcome_index,
        sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1e6 as cash_spent,
        sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1e6 as cash_received,
        sum(t.fee_amount) / 1e6 as fees_paid,
        (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6 as net_shares,
        IF(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
        (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6 as trading_pnl,
        CASE
          WHEN any(r.condition_id) IS NOT NULL
               AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
          THEN greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
          ELSE 0
        END as resolution_credit,
        (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6
        + CASE
            WHEN any(r.condition_id) IS NOT NULL
                 AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
            THEN greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
            ELSE 0
          END as total_pnl
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
      LEFT JOIN pm_condition_resolutions r ON r.condition_id = m.condition_id
      WHERE t.trader_wallet = '${WALLET}'
        AND t.is_deleted = 0
      GROUP BY m.condition_id, m.outcome_index
    )`)

  // 7. Check position-level comparison
  await runQuery('7. POSITION COMPARISON: pm_user_positions vs COMPUTED',
    `WITH computed AS (
      SELECT
        m.condition_id,
        sum(t.usdc_amount) / 1e6 as computed_total_usdc,
        (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6 as computed_trading_pnl
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
      WHERE t.trader_wallet = '${WALLET}'
        AND t.is_deleted = 0
      GROUP BY m.condition_id
    ),
    goldsky AS (
      SELECT
        condition_id,
        sum(realized_pnl) / 1e6 as goldsky_realized_pnl,
        sum(total_bought) / 1e6 as goldsky_bought,
        sum(total_sold) / 1e6 as goldsky_sold
      FROM pm_user_positions
      WHERE proxy_wallet = '${WALLET}'
        AND is_deleted = 0
      GROUP BY condition_id
    )
    SELECT
      c.condition_id,
      round(c.computed_trading_pnl, 2) as computed_pnl,
      round(g.goldsky_realized_pnl, 2) as goldsky_pnl,
      round(c.computed_trading_pnl - g.goldsky_realized_pnl, 2) as pnl_diff,
      round(c.computed_total_usdc, 2) as computed_volume,
      round(g.goldsky_bought + g.goldsky_sold, 2) as goldsky_volume
    FROM computed c
    LEFT JOIN goldsky g ON g.condition_id = c.condition_id
    ORDER BY abs(c.computed_trading_pnl - coalesce(g.goldsky_realized_pnl, 0)) DESC
    LIMIT 10`)

  // 8. Summary comparison
  console.log('
' + '='.repeat(70))
  console.log('SUMMARY: THREE SOURCES OF TRUTH')
  console.log('='.repeat(70))
  console.log('1. pm_user_positions.realized_pnl (Goldsky): +$28.8M')
  console.log('2. Analytics site (polymarketanalytics.com): ~-$10M')
  console.log('3. Our cash ledger from fills: See query #6 above')
  console.log('')
  console.log('If #3 matches #1 but not #2:')
  console.log('  → Analytics site uses a DIFFERENT PnL definition')
  console.log('  → Maybe includes open positions, different fees, etc.')
  console.log('')
  console.log('If #3 matches #2 but not #1:')
  console.log('  → pm_user_positions.realized_pnl is NOT what we want')
  console.log('  → We need to stop using it as ground truth')
  console.log('')
  console.log('If #3 matches NEITHER:')
  console.log('  → Our cash ledger logic is wrong (unit scaling, side detection, etc.)')

  await clickhouse.close()
  console.log('
✅ Calibration diagnostic complete!')
}

main().catch(error => {
  console.error('
FATAL ERROR:', error)
  process.exit(1)
})
