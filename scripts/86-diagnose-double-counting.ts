#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Diagnosing potential double-counting issue...\n`);
  console.log(`Expected P&L: ~$185,000 (Polymarket + Dome API)`);
  console.log(`Our P&L: $2,186,793\n`);

  // Get detailed breakdown
  const result = await clickhouse.query({
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
          proceeds_sell - cost_buy AS trade_pnl,
          count() AS fills
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
          t.net_shares * payout_per_share AS settlement_value,
          t.trade_pnl + settlement_value AS total_pnl
        FROM trades_by_market t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      )
      SELECT
        -- Counts
        count() AS total_positions,
        countIf(winning_outcome IS NOT NULL) AS resolved_count,
        countIf(winning_outcome IS NULL) AS open_count,

        -- Trade P&L components
        sum(cost_buy) AS total_cost,
        sum(proceeds_sell) AS total_proceeds,
        sum(trade_pnl) AS total_trade_pnl,

        -- Settlement components
        sum(settlement_value) AS total_settlement,
        sumIf(settlement_value, winning_outcome IS NOT NULL) AS resolved_settlement,
        sumIf(settlement_value, winning_outcome IS NULL) AS open_settlement,

        -- Combined P&L
        sum(total_pnl) AS combined_pnl,
        sumIf(total_pnl, winning_outcome IS NOT NULL) AS resolved_combined_pnl,
        sumIf(total_pnl, winning_outcome IS NULL) AS open_combined_pnl,

        -- Just trade P&L (no settlement)
        sumIf(trade_pnl, winning_outcome IS NOT NULL) AS resolved_trade_only_pnl,
        sumIf(trade_pnl, winning_outcome IS NULL) AS open_trade_only_pnl
      FROM with_resolutions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POSITION COUNTS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:        ${parseInt(r.total_positions)}`);
  console.log(`  Resolved (closed):      ${parseInt(r.resolved_count)}`);
  console.log(`  Open:                   ${parseInt(r.open_count)}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRADE P&L (Buy/Sell on CLOB):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Cost (buys):      $${parseFloat(r.total_cost).toLocaleString()}`);
  console.log(`  Total Proceeds (sells): $${parseFloat(r.total_proceeds).toLocaleString()}`);
  console.log(`  Trade P&L (net):        $${parseFloat(r.total_trade_pnl).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SETTLEMENT P&L (Redemptions):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Settlement:       $${parseFloat(r.total_settlement).toLocaleString()}`);
  console.log(`  Resolved Settlement:    $${parseFloat(r.resolved_settlement).toLocaleString()}`);
  console.log(`  Open Settlement:        $${parseFloat(r.open_settlement).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMBINED P&L (Trade + Settlement):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Combined:         $${parseFloat(r.combined_pnl).toLocaleString()}`);
  console.log(`  Resolved Combined:      $${parseFloat(r.resolved_combined_pnl).toLocaleString()}`);
  console.log(`  Open Combined:          $${parseFloat(r.open_combined_pnl).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ALTERNATIVE: TRADE P&L ONLY (No Settlement):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Resolved Trade Only:    $${parseFloat(r.resolved_trade_only_pnl).toLocaleString()}`);
  console.log(`  Open Trade Only:        $${parseFloat(r.open_trade_only_pnl).toLocaleString()}`);
  console.log(`  Total Trade Only:       $${(parseFloat(r.resolved_trade_only_pnl) + parseFloat(r.open_trade_only_pnl)).toLocaleString()}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════');

  const tradeOnly = parseFloat(r.total_trade_pnl);
  const withSettlement = parseFloat(r.combined_pnl);
  const expectedPnL = 185000;

  console.log(`\n1️⃣  Trade P&L Only: $${tradeOnly.toLocaleString()}`);
  if (Math.abs(tradeOnly - expectedPnL) < 50000) {
    console.log(`    ✅ MATCHES expected $${expectedPnL.toLocaleString()} (±$50k)`);
    console.log(`    → We should use trade_pnl WITHOUT adding settlement_value`);
  } else {
    console.log(`    ❌ Doesn't match expected $${expectedPnL.toLocaleString()}`);
  }

  console.log(`\n2️⃣  Trade + Settlement: $${withSettlement.toLocaleString()}`);
  if (Math.abs(withSettlement - expectedPnL) < 50000) {
    console.log(`    ✅ MATCHES expected $${expectedPnL.toLocaleString()} (±$50k)`);
  } else {
    console.log(`    ❌ Doesn't match expected $${expectedPnL.toLocaleString()}`);
    console.log(`    → We might be double-counting by adding settlement to already-sold positions`);
  }

  console.log(`\n3️⃣  Hypothesis:`);
  const settlementValue = parseFloat(r.total_settlement);
  console.log(`    Settlement value: $${settlementValue.toLocaleString()}`);
  console.log(`    If settlement is being ADDED to proceeds_sell:`);
  console.log(`      - This double-counts redemptions`);
  console.log(`      - Redemptions should REPLACE sell proceeds, not add to them`);
}

main().catch(console.error);
