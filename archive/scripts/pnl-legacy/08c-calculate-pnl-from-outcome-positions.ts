import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculatePnLFromOutcomePositions() {
  console.log('=== Calculating PnL from outcome_positions_v3 ===\n');
  console.log('This table has cashflow_usd and net_shares for each position.');
  console.log('');

  // First, get sample data to understand the structure
  console.log('Sample positions:\n');

  const sampleQuery = `
    SELECT *
    FROM outcome_positions_v3
    WHERE lower(wallet) = lower('${EOA}')
    ORDER BY abs(cashflow_usd) DESC
    LIMIT 5
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json<any[]>();

  samples.forEach((s, i) => {
    console.log(`${i + 1}. Condition: ${s.condition_id_norm.substring(0, 16)}...`);
    console.log(`   Outcome idx: ${s.idx}`);
    console.log(`   Net shares:  ${Number(s.net_shares).toFixed(2)}`);
    console.log(`   Cashflow:    $${Number(s.cashflow_usd).toFixed(2)}`);
    console.log('');
  });

  // Calculate total PnL using cashflow
  console.log('Calculating total PnL...\n');

  // Strategy: outcome_positions_v3 has cashflow which is the net cash in/out
  // For resolved positions, we need to:
  // 1. Get cashflow (cost basis)
  // 2. Calculate settlement value based on resolution
  // 3. PnL = settlement_value - abs(cashflow)

  const pnlQuery = `
    WITH
      positions_with_resolutions AS (
        SELECT
          op.wallet,
          op.condition_id_norm,
          op.idx,
          op.net_shares,
          op.cashflow_usd,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          -- Calculate settlement value
          if(
            r.payout_denominator > 0 AND op.idx IS NOT NULL,
            toFloat64(op.net_shares) * (toFloat64(arrayElement(r.payout_numerators, op.idx + 1)) / toFloat64(r.payout_denominator)),
            0
          ) AS settlement_value,
          -- Calculate realized PnL
          -- PnL = settlement_value + cashflow (cashflow is negative for costs)
          if(
            r.payout_denominator > 0 AND op.idx IS NOT NULL,
            (toFloat64(op.net_shares) * (toFloat64(arrayElement(r.payout_numerators, op.idx + 1)) / toFloat64(r.payout_denominator))) + toFloat64(op.cashflow_usd),
            toFloat64(op.cashflow_usd)
          ) AS realized_pnl
        FROM outcome_positions_v3 op
        INNER JOIN market_resolutions_final r
          ON op.condition_id_norm = r.condition_id_norm
        WHERE lower(op.wallet) = lower('${EOA}')
          AND r.payout_denominator > 0
          AND abs(op.net_shares) > 0.001
      )

    SELECT
      count() AS total_positions,
      sum(abs(cashflow_usd)) AS total_volume,
      sumIf(realized_pnl, realized_pnl > 0) AS total_profit,
      sumIf(realized_pnl, realized_pnl < 0) AS total_loss,
      sum(realized_pnl) AS net_pnl,
      countIf(realized_pnl > 0) AS winning_positions,
      countIf(realized_pnl < 0) AS losing_positions
    FROM positions_with_resolutions
  `;

  const result = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  console.log('═══════════════════════════════════════════════════════');
  console.log('      PnL from outcome_positions_v3 + Resolutions      ');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 VOLUME & ACTIVITY');
  console.log(`  Total Volume:      $${Number(data[0].total_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Resolved Positions: ${data[0].total_positions}`);
  console.log('');
  console.log('💰 PROFIT & LOSS');
  console.log(`  Total Profit:      $${Number(data[0].total_profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Total Loss:        -$${Math.abs(Number(data[0].total_loss)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  NET PnL:           ${Number(data[0].net_pnl) >= 0 ? '✅' : '❌'} $${Number(data[0].net_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('');
  console.log('📈 WIN RATE');
  console.log(`  Winning Positions: ${data[0].winning_positions}`);
  console.log(`  Losing Positions:  ${data[0].losing_positions}`);
  console.log(`  Win Rate:          ${((Number(data[0].winning_positions) / Number(data[0].total_positions)) * 100).toFixed(2)}%`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const polymarketPnL = 87030.505;
  const ourPnL = Number(data[0].net_pnl);
  const difference = ourPnL - polymarketPnL;

  console.log('Comparison to Polymarket Reality:');
  console.log(`  Polymarket PnL:    $${polymarketPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Our Calculated PnL: $${ourPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Difference:        $${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  % Error:           ${((Math.abs(difference) / polymarketPnL) * 100).toFixed(2)}%`);
  console.log('');

  if (Math.abs(difference) < 1000) {
    console.log('✅✅✅ EXCELLENT! Within $1,000 of Polymarket reality!');
  } else if (Math.abs(difference) < 10000) {
    console.log('✅ Very good! Within $10,000 of Polymarket reality.');
  } else if (Math.abs(difference) < 50000) {
    console.log('⚠️  Decent - within $50,000 but needs investigation.');
  } else {
    console.log('❌ Still significant discrepancy.');
  }
  console.log('');

  // Debug a specific position to see the math
  console.log('Sample calculation detail:\n');

  const detailQuery = `
    WITH
      positions_with_resolutions AS (
        SELECT
          op.condition_id_norm,
          op.idx,
          op.net_shares,
          op.cashflow_usd,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          arrayElement(r.payout_numerators, op.idx + 1) AS payout_num,
          if(
            r.payout_denominator > 0 AND op.idx IS NOT NULL,
            toFloat64(op.net_shares) * (toFloat64(arrayElement(r.payout_numerators, op.idx + 1)) / toFloat64(r.payout_denominator)),
            0
          ) AS settlement_value,
          if(
            r.payout_denominator > 0 AND op.idx IS NOT NULL,
            (toFloat64(op.net_shares) * (toFloat64(arrayElement(r.payout_numerators, op.idx + 1)) / toFloat64(r.payout_denominator))) + toFloat64(op.cashflow_usd),
            toFloat64(op.cashflow_usd)
          ) AS realized_pnl
        FROM outcome_positions_v3 op
        INNER JOIN market_resolutions_final r
          ON op.condition_id_norm = r.condition_id_norm
        WHERE lower(op.wallet) = lower('${EOA}')
          AND r.payout_denominator > 0
          AND abs(op.net_shares) > 0.001
      )

    SELECT *
    FROM positions_with_resolutions
    WHERE realized_pnl > 0
    ORDER BY realized_pnl DESC
    LIMIT 1
  `;

  const detailResult = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
  const detailData = await detailResult.json<any[]>();

  if (detailData.length > 0) {
    const p = detailData[0];
    console.log('Top winning position:');
    console.log(`  Condition:         ${p.condition_id_norm.substring(0, 16)}...`);
    console.log(`  Outcome idx:       ${p.idx}`);
    console.log(`  Winning idx:       ${p.winning_index}`);
    console.log(`  Net shares:        ${Number(p.net_shares).toFixed(2)}`);
    console.log(`  Cashflow:          $${Number(p.cashflow_usd).toFixed(2)}`);
    console.log(`  Payout ratio:      ${p.payout_num}/${p.payout_denominator}`);
    console.log(`  Settlement value:  $${Number(p.settlement_value).toFixed(2)}`);
    console.log(`  Realized PnL:      $${Number(p.realized_pnl).toFixed(2)}`);
    console.log('');
    console.log('Math:');
    console.log(`  Settlement = ${Number(p.net_shares).toFixed(2)} × (${p.payout_num}/${p.payout_denominator}) = $${Number(p.settlement_value).toFixed(2)}`);
    console.log(`  PnL = $${Number(p.settlement_value).toFixed(2)} + $${Number(p.cashflow_usd).toFixed(2)} = $${Number(p.realized_pnl).toFixed(2)}`);
  }
}

calculatePnLFromOutcomePositions().catch(console.error);
