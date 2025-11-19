#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Investigating Wallet 10 discrepancy...\n`);
  console.log(`Wallet: ${WALLET}\n`);

  // 1. Check trade count breakdown
  const tradeBreakdown = await clickhouse.query({
    query: `
      SELECT
        count() AS total_fills,
        count(DISTINCT condition_id_norm_v3) AS unique_conditions,
        count(DISTINCT market_id) AS unique_markets,
        countIf(trade_direction = 'BUY') AS buys,
        countIf(trade_direction = 'SELL') AS sells,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND condition_id_norm_v3 != ''
    `,
    format: 'JSONEachRow'
  });

  const breakdown = await tradeBreakdown.json<Array<any>>();
  const b = breakdown[0];

  console.log('📊 Trade Count Breakdown:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Fills (CLOB):     ${parseInt(b.total_fills).toLocaleString()}`);
  console.log(`  Unique Conditions:      ${parseInt(b.unique_conditions).toLocaleString()}`);
  console.log(`  Unique Markets:         ${parseInt(b.unique_markets).toLocaleString()}`);
  console.log(`  Buys:                   ${parseInt(b.buys).toLocaleString()}`);
  console.log(`  Sells:                  ${parseInt(b.sells).toLocaleString()}`);
  console.log(`  First Trade:            ${b.first_trade}`);
  console.log(`  Last Trade:             ${b.last_trade}`);
  console.log();

  // 2. Check if we're counting positions vs fills
  const positionCount = await clickhouse.query({
    query: `
      SELECT
        count() AS total_positions,
        countIf(net_shares != 0) AS non_zero_positions,
        countIf(net_shares > 0) AS long_positions,
        countIf(net_shares < 0) AS short_positions
      FROM (
        SELECT
          condition_id_norm_v3,
          outcome_index_v3,
          sumIf(toFloat64(shares), trade_direction = 'BUY') -
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY condition_id_norm_v3, outcome_index_v3
      )
    `,
    format: 'JSONEachRow'
  });

  const positions = await positionCount.json<Array<any>>();
  const p = positions[0];

  console.log('📈 Position Count (Unique Market+Outcome):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:        ${parseInt(p.total_positions).toLocaleString()}`);
  console.log(`  Non-Zero Positions:     ${parseInt(p.non_zero_positions).toLocaleString()}`);
  console.log(`  Long Positions:         ${parseInt(p.long_positions).toLocaleString()}`);
  console.log(`  Short Positions:        ${parseInt(p.short_positions).toLocaleString()}`);
  console.log();

  // 3. Check P&L components
  const pnlBreakdown = await clickhouse.query({
    query: `
      WITH trades_by_market AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          proceeds_sell - cost_buy AS trade_pnl
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      ),
      with_resolutions AS (
        SELECT
          t.*,
          r.winning_outcome,
          if(
            r.payout_denominator = 0
              OR r.payout_denominator IS NULL
              OR length(r.payout_numerators) < t.outcome_idx + 1,
            0,
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
          ) AS payout_per_share,
          t.net_shares * payout_per_share AS settlement_value
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      )
      SELECT
        count() AS total_positions,
        countIf(winning_outcome IS NOT NULL) AS resolved_positions,
        countIf(winning_outcome IS NULL) AS open_positions,
        sum(trade_pnl) AS total_trade_pnl,
        sum(settlement_value) AS total_settlement,
        sum(trade_pnl + settlement_value) AS total_pnl,
        sumIf(trade_pnl, winning_outcome IS NOT NULL) AS resolved_trade_pnl,
        sumIf(trade_pnl, winning_outcome IS NULL) AS open_trade_pnl
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const pnl = await pnlBreakdown.json<Array<any>>();
  const pnlData = pnl[0];

  console.log('💰 P&L Breakdown:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:        ${parseInt(pnlData.total_positions).toLocaleString()}`);
  console.log(`  Resolved Positions:     ${parseInt(pnlData.resolved_positions).toLocaleString()}`);
  console.log(`  Open Positions:         ${parseInt(pnlData.open_positions).toLocaleString()}`);
  console.log();
  console.log(`  Trade P&L (All):        $${parseFloat(pnlData.total_trade_pnl).toLocaleString()}`);
  console.log(`  Trade P&L (Resolved):   $${parseFloat(pnlData.resolved_trade_pnl).toLocaleString()}`);
  console.log(`  Trade P&L (Open):       $${parseFloat(pnlData.open_trade_pnl).toLocaleString()}`);
  console.log(`  Settlement Value:       $${parseFloat(pnlData.total_settlement).toLocaleString()}`);
  console.log(`  Total P&L:              $${parseFloat(pnlData.total_pnl).toLocaleString()}`);
  console.log();

  // 4. Compare with Polymarket UI
  console.log('🔍 Comparison with Polymarket UI:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Polymarket "Predictions":   94`);
  console.log(`  Our Unique Positions:       ${parseInt(p.total_positions).toLocaleString()}`);
  console.log(`  Our Non-Zero Positions:     ${parseInt(p.non_zero_positions).toLocaleString()}`);
  console.log(`  Our Open Positions:         ${parseInt(pnlData.open_positions).toLocaleString()}`);
  console.log();
  console.log(`  Polymarket P&L:             $184,862`);
  console.log(`  Our Total P&L:              $${parseFloat(pnlData.total_pnl).toLocaleString()}`);
  console.log(`  Our Open Position P&L:      $${parseFloat(pnlData.open_trade_pnl).toLocaleString()}`);
  console.log();

  // Hypothesis
  console.log('💡 Hypothesis:');
  console.log('═══════════════════════════════════════════════════════════════');

  if (parseInt(pnlData.open_positions) < 94) {
    console.log(`  ⚠️  We show fewer open positions (${pnlData.open_positions}) than Polymarket (94)`);
    console.log('      → Possible issue with resolution data');
  } else if (parseInt(pnlData.open_positions) > 94) {
    console.log(`  ⚠️  We show more open positions (${pnlData.open_positions}) than Polymarket (94)`);
    console.log('      → Polymarket might only show "active" positions (non-zero, above threshold)');
  }

  const openPnL = parseFloat(pnlData.open_trade_pnl);
  const polymarketPnL = 184862;

  if (Math.abs(openPnL - polymarketPnL) < 10000) {
    console.log(`  ✅ Our Open P&L ($${openPnL.toLocaleString()}) matches Polymarket ($${polymarketPnL.toLocaleString()})`);
    console.log('      → Polymarket likely shows ONLY open/unrealized P&L');
  } else {
    console.log(`  ⚠️  Our Open P&L ($${openPnL.toLocaleString()}) != Polymarket ($${polymarketPnL.toLocaleString()})`);
    console.log(`      → Difference: $${(openPnL - polymarketPnL).toLocaleString()}`);
  }

  console.log();
  console.log('📝 Key Insight:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Polymarket UI likely shows:');
  console.log('    - "Predictions" = Open/Active positions only');
  console.log('    - "P&L" = Unrealized P&L on open positions');
  console.log();
  console.log('  Our calculation shows:');
  console.log('    - "Trades" = All CLOB fills (2,795)');
  console.log('    - "P&L" = Total realized + unrealized P&L ($2.2M)');
}

main().catch(console.error);
