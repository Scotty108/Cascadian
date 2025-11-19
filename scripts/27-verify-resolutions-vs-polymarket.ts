import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function verifyResolutionsVsPolymarket() {
  console.log('=== Verifying Resolutions vs Polymarket ===\n');

  // Get a sample of the wallet's largest positions
  const query = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
        count() AS trade_count
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      p.condition_id,
      p.outcome_idx,
      p.net_shares,
      p.net_cost,
      p.trade_count,
      r.payout_numerators,
      r.payout_denominator,
      r.winning_index,
      r.winning_outcome,
      r.source AS resolution_source,
      if(
        r.payout_denominator > 0,
        (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))),
        0
      ) AS settlement_value,
      if(
        r.payout_denominator > 0,
        (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
        -toFloat64(p.net_cost)
      ) AS realized_pnl
    FROM positions p
    INNER JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
    ORDER BY abs(net_cost) DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = await result.json<any[]>();

  console.log('Top 20 Resolved Positions (by cost):');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  let totalWins = 0;
  let totalLosses = 0;

  positions.forEach((pos, i) => {
    const pnl = Number(pos.realized_pnl);
    const payoutArray = Array.isArray(pos.payout_numerators) ? pos.payout_numerators : [];
    const myPayout = payoutArray[pos.outcome_idx] || 0;

    console.log(`[${i + 1}] ${pos.condition_id.substring(0, 16)}...`);
    console.log(`    Outcome: ${pos.outcome_idx}, Winning: ${pos.winning_index} (${pos.winning_outcome})`);
    console.log(`    Payout: ${myPayout}/${pos.payout_denominator}`);
    console.log(`    Net: ${Number(pos.net_shares).toFixed(2)} shares, $${Number(pos.net_cost).toFixed(2)} cost`);
    console.log(`    Settlement: $${Number(pos.settlement_value).toFixed(2)}`);
    console.log(`    PnL: ${pnl >= 0 ? '✅' : '❌'} $${pnl.toFixed(2)}`);
    console.log('');

    if (pnl > 0) totalWins++;
    else totalLosses++;
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`Wins: ${totalWins}, Losses: ${totalLosses} (in top 20)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // KEY CHECK: Are we betting on the WRONG outcome consistently?
  const outcomeAnalysisQuery = `
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
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      countIf(p.outcome_idx = r.winning_index) AS bet_on_winner,
      countIf(p.outcome_idx != r.winning_index) AS bet_on_loser,
      count() AS total_resolved
    FROM positions p
    INNER JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
  `;

  const outcomeResult = await clickhouse.query({ query: outcomeAnalysisQuery, format: 'JSONEachRow' });
  const outcomeData = await outcomeResult.json<any[]>();

  console.log('Outcome Analysis:');
  console.log(`  Bet on winning outcome: ${outcomeData[0].bet_on_winner}`);
  console.log(`  Bet on losing outcome: ${outcomeData[0].bet_on_loser}`);
  console.log(`  Total: ${outcomeData[0].total_resolved}`);
  console.log(`  Win rate: ${((outcomeData[0].bet_on_winner / outcomeData[0].total_resolved) * 100).toFixed(1)}%`);
  console.log('');

  if (outcomeData[0].bet_on_loser > outcomeData[0].bet_on_winner * 2) {
    console.log('🚨 CRITICAL: Wallet bet on losing outcome in most markets!');
    console.log('   This could indicate:');
    console.log('     1. The wallet is actually a bad trader (unlikely for "xcnstrategy")');
    console.log('     2. Our outcome_index mapping is INVERTED');
    console.log('     3. Our resolution data has wrong winning_index');
    console.log('');
  }

  // Test inversion hypothesis
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('TESTING INVERSION HYPOTHESIS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('What if we FLIP all outcomes (0→1, 1→0)?');
  console.log('');

  const inversionQuery = `
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
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    ),
    resolved_normal AS (
      SELECT sum(
        if(
          r.payout_denominator > 0,
          (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
          -toFloat64(p.net_cost)
        )
      ) AS pnl
      FROM positions p
      INNER JOIN market_resolutions_final r ON p.condition_id = r.condition_id_norm
      WHERE r.payout_denominator > 0
    ),
    resolved_inverted AS (
      SELECT sum(
        if(
          r.payout_denominator > 0 AND r.outcome_count = 2,
          (toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, if(p.outcome_idx = 0, 2, 1))) / toFloat64(r.payout_denominator))) - toFloat64(p.net_cost),
          -toFloat64(p.net_cost)
        )
      ) AS pnl
      FROM positions p
      INNER JOIN market_resolutions_final r ON p.condition_id = r.condition_id_norm
      WHERE r.payout_denominator > 0
    )
    SELECT
      (SELECT pnl FROM resolved_normal) AS normal_pnl,
      (SELECT pnl FROM resolved_inverted) AS inverted_pnl
  `;

  const inversionResult = await clickhouse.query({ query: inversionQuery, format: 'JSONEachRow' });
  const inversionData = await inversionResult.json<any[]>();

  console.log(`Normal PnL:   $${Number(inversionData[0].normal_pnl).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`Inverted PnL: $${Number(inversionData[0].inverted_pnl).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  const invertedError = Math.abs(Number(inversionData[0].inverted_pnl) - 87030.51);
  const normalError = Math.abs(Number(inversionData[0].normal_pnl) - 87030.51);

  if (invertedError < normalError) {
    console.log('🔥🔥🔥 BREAKTHROUGH!!! Inverted PnL is CLOSER to Polymarket!');
    console.log(`   Normal error: $${normalError.toLocaleString()}`);
    console.log(`   Inverted error: $${invertedError.toLocaleString()}`);
    console.log('');
    console.log('   This suggests our outcome_index mapping is INVERTED!');
  } else {
    console.log('❌ Inversion does not help.');
  }

  console.log('');
}

verifyResolutionsVsPolymarket().catch(console.error);
