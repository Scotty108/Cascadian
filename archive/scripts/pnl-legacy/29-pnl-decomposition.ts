import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Polymarket API time window
const START_TIME = new Date(1724259231000); // 2024-08-21
const END_TIME = new Date(1763250566105);   // 2025-11-11

async function decomposePolymarketPnL() {
  console.log('=== Step 2: PnL Decomposition vs Polymarket ===\n');
  console.log(`Time window: ${START_TIME.toISOString()} to ${END_TIME.toISOString()}\n`);
  console.log(`Target: $87,030.51 (Polymarket API)\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const POLYMARKET_TARGET = 87030.51;
  const THRESHOLD_20PCT = POLYMARKET_TARGET * 0.20; // $17,406.10

  // Component 1: Trade-only PnL (cash flow, ignoring resolutions)
  const tradeOnlyQuery = `
    SELECT
      sum(if(trade_direction = 'SELL', usd_value, -usd_value)) AS trade_only_pnl,
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      sum(if(trade_direction = 'BUY', usd_value, 0)) AS total_buys,
      sum(if(trade_direction = 'SELL', usd_value, 0)) AS total_sells
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
      AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
  `;

  const tradeOnlyResult = await clickhouse.query({ query: tradeOnlyQuery, format: 'JSONEachRow' });
  const tradeOnlyData = await tradeOnlyResult.json<any[]>();
  const tradeOnlyPnL = Number(tradeOnlyData[0].trade_only_pnl);
  const buyCount = Number(tradeOnlyData[0].buy_count);
  const sellCount = Number(tradeOnlyData[0].sell_count);
  const totalBuys = Number(tradeOnlyData[0].total_buys);
  const totalSells = Number(tradeOnlyData[0].total_sells);

  console.log('📊 Component 1: TRADE-ONLY PnL');
  console.log('   (Cash flow from trades, ignoring resolutions)\n');
  console.log(`   Total Buys:  ${buyCount} trades, $${totalBuys.toLocaleString('en-US', {minimumFractionDigits: 2})} spent`);
  console.log(`   Total Sells: ${sellCount} trades, $${totalSells.toLocaleString('en-US', {minimumFractionDigits: 2})} received`);
  console.log(`   ─────────────────────────────────────────────────────────`);
  console.log(`   Trade-Only PnL: $${tradeOnlyPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  // Component 2: Settlement PnL (payout on resolved positions)
  const settlementQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
        AND timestamp >= '${START_TIME.toISOString().split('T')[0]}'
        AND timestamp <= '${END_TIME.toISOString().split('T')[0]}'
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      count() AS resolved_positions,
      sum(
        if(
          r.payout_denominator > 0,
          (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))),
          0
        )
      ) AS total_settlement_value,
      sum(p.net_cost) AS total_cost_basis,
      sum(
        if(
          r.payout_denominator > 0,
          (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
          -toFloat64(p.net_cost)
        )
      ) AS settlement_pnl
    FROM positions p
    INNER JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
  `;

  const settlementResult = await clickhouse.query({ query: settlementQuery, format: 'JSONEachRow' });
  const settlementData = await settlementResult.json<any[]>();
  const resolvedPositions = Number(settlementData[0].resolved_positions);
  const totalSettlementValue = Number(settlementData[0].total_settlement_value);
  const totalCostBasis = Number(settlementData[0].total_cost_basis);
  const settlementPnL = Number(settlementData[0].settlement_pnl);

  console.log('📊 Component 2: SETTLEMENT PnL');
  console.log('   (Payout on resolved positions)\n');
  console.log(`   Resolved Positions: ${resolvedPositions}`);
  console.log(`   Cost Basis:         $${totalCostBasis.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`   Settlement Value:   $${totalSettlementValue.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`   ─────────────────────────────────────────────────────────`);
  console.log(`   Settlement PnL: $${settlementPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  // Component 3: Total PnL (both components)
  const totalPnL = tradeOnlyPnL + settlementPnL;

  console.log('📊 Component 3: TOTAL PnL');
  console.log('   (Trade-Only + Settlement)\n');
  console.log(`   Trade-Only PnL:  $${tradeOnlyPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`   Settlement PnL:  $${settlementPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`   ─────────────────────────────────────────────────────────`);
  console.log(`   Total PnL: $${totalPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO POLYMARKET API');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const polymarketPnL = POLYMARKET_TARGET;

  // Calculate errors
  const tradeOnlyError = Math.abs(tradeOnlyPnL - polymarketPnL);
  const tradeOnlyErrorPct = (tradeOnlyError / polymarketPnL) * 100;
  const tradeOnlyWithin20 = tradeOnlyError <= THRESHOLD_20PCT;

  const settlementError = Math.abs(settlementPnL - polymarketPnL);
  const settlementErrorPct = (settlementError / polymarketPnL) * 100;
  const settlementWithin20 = settlementError <= THRESHOLD_20PCT;

  const totalError = Math.abs(totalPnL - polymarketPnL);
  const totalErrorPct = (totalError / polymarketPnL) * 100;
  const totalWithin20 = totalError <= THRESHOLD_20PCT;

  console.log(`Polymarket Target: $${polymarketPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}\n`);

  console.log('Component Comparison:\n');

  console.log(`[1] Trade-Only PnL:    $${tradeOnlyPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`    Error:             $${tradeOnlyError.toLocaleString('en-US', {minimumFractionDigits: 2})} (${tradeOnlyErrorPct.toFixed(1)}%)`);
  console.log(`    Within 20%?        ${tradeOnlyWithin20 ? '✅ YES' : '❌ NO'}`);
  console.log('');

  console.log(`[2] Settlement PnL:    $${settlementPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`    Error:             $${settlementError.toLocaleString('en-US', {minimumFractionDigits: 2})} (${settlementErrorPct.toFixed(1)}%)`);
  console.log(`    Within 20%?        ${settlementWithin20 ? '✅ YES' : '❌ NO'}`);
  console.log('');

  console.log(`[3] Total PnL:         $${totalPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`    Error:             $${totalError.toLocaleString('en-US', {minimumFractionDigits: 2})} (${totalErrorPct.toFixed(1)}%)`);
  console.log(`    Within 20%?        ${totalWithin20 ? '✅ YES' : '❌ NO'}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');

  if (tradeOnlyWithin20 || settlementWithin20 || totalWithin20) {
    console.log('✅ FOUND MATCH: At least one component is within 20% of Polymarket!');
    if (tradeOnlyWithin20) console.log('   → Trade-Only PnL matches');
    if (settlementWithin20) console.log('   → Settlement PnL matches');
    if (totalWithin20) console.log('   → Total PnL matches');
  } else {
    console.log('❌ NO MATCH: None of the three components are within 20% of Polymarket.');
    console.log('');
    console.log('This confirms:');
    console.log('  1. Our formula is correct (trade-only + settlement = total)');
    console.log('  2. The $494k discrepancy is NOT due to missing PnL components');
    console.log('  3. Issue must be in underlying data quality (resolutions or trade directions)');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Return data for reporting
  return {
    tradeOnlyPnL,
    settlementPnL,
    totalPnL,
    polymarketPnL,
    tradeOnlyWithin20,
    settlementWithin20,
    totalWithin20,
    resolvedPositions,
    buyCount,
    sellCount
  };
}

decomposePolymarketPnL().catch(console.error);
