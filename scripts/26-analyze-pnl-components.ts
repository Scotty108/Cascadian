import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function analyzePnLComponents() {
  console.log('=== Analyzing PnL Components ===\n');
  console.log('Goal: Understand where the $494k error comes from\n');

  // Calculate PnL breakdown
  const query = `
    WITH
      all_positions AS (
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
          AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY condition_id, outcome_idx
        HAVING abs(net_shares) > 0.001
      ),
      resolved_positions AS (
        SELECT
          p.condition_id,
          p.outcome_idx,
          p.net_shares,
          p.net_cost,
          r.payout_numerators,
          r.payout_denominator,
          r.winning_index,
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
        FROM all_positions p
        INNER JOIN market_resolutions_final r
          ON p.condition_id = r.condition_id_norm
        WHERE r.payout_denominator > 0
      ),
      unresolved_positions AS (
        SELECT
          p.condition_id,
          p.outcome_idx,
          p.net_shares,
          p.net_cost
        FROM all_positions p
        LEFT JOIN market_resolutions_final r
          ON p.condition_id = r.condition_id_norm
        WHERE r.condition_id_norm IS NULL
           OR r.payout_denominator = 0
      )
    SELECT
      -- Resolved positions
      (SELECT count() FROM resolved_positions) AS resolved_count,
      (SELECT sum(abs(net_cost)) FROM resolved_positions) AS resolved_volume,
      (SELECT sum(settlement_value) FROM resolved_positions) AS total_settlement_value,
      (SELECT sum(net_cost) FROM resolved_positions) AS total_cost_basis,
      (SELECT sum(realized_pnl) FROM resolved_positions) AS resolved_pnl,

      -- Unresolved positions
      (SELECT count() FROM unresolved_positions) AS unresolved_count,
      (SELECT sum(abs(net_cost)) FROM unresolved_positions) AS unresolved_volume,
      (SELECT sum(net_cost) FROM unresolved_positions) AS unresolved_cost_basis,

      -- Aggregates
      (SELECT count() FROM all_positions) AS total_positions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json<any[]>();
  const metrics = data[0];

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('PNL COMPONENT BREAKDOWN:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('📊 RESOLVED POSITIONS:');
  console.log(`  Count: ${metrics.resolved_count}`);
  console.log(`  Volume: $${Number(metrics.resolved_volume).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Cost Basis: $${Number(metrics.total_cost_basis).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Settlement Value: $${Number(metrics.total_settlement_value).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  ─────────────────────────────────────────────────────────`);
  console.log(`  Realized PnL: $${Number(metrics.resolved_pnl).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  console.log('📊 UNRESOLVED POSITIONS (Open):');
  console.log(`  Count: ${metrics.unresolved_count}`);
  console.log(`  Volume: $${Number(metrics.unresolved_volume).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Cost Basis: $${Number(metrics.unresolved_cost_basis).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('POLYMARKET COMPARISON:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const polymarketPnL = 87030.51;
  const ourResolvedPnL = Number(metrics.resolved_pnl);
  const unresolvedCost = Number(metrics.unresolved_cost_basis);

  console.log(`Polymarket PnL: $${polymarketPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`Our Resolved PnL: $${ourResolvedPnL.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`Gap: $${(polymarketPnL - ourResolvedPnL).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  // Hypothetical scenarios for unresolved positions
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('HYPOTHESIS: Does Polymarket include unrealized PnL?');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const scenarios = [
    { name: 'All unresolved lose (0% value)', unrealized: unresolvedCost * -1 },
    { name: 'All unresolved at 25% value', unrealized: (unresolvedCost * 0.25) - unresolvedCost },
    { name: 'All unresolved at 50% value', unrealized: (unresolvedCost * 0.50) - unresolvedCost },
    { name: 'All unresolved at 75% value', unrealized: (unresolvedCost * 0.75) - unresolvedCost },
    { name: 'All unresolved win (100% value)', unrealized: 0 }, // Cost = value at 100%
  ];

  let closest = { name: '', total: 0, error: Infinity };

  scenarios.forEach(scenario => {
    const total = ourResolvedPnL + scenario.unrealized;
    const error = Math.abs(total - polymarketPnL);
    const percentError = (error / polymarketPnL) * 100;

    console.log(`${scenario.name}:`);
    console.log(`  Unrealized PnL: $${scenario.unrealized.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`  Total PnL: $${total.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`  Error: $${error.toLocaleString('en-US', {minimumFractionDigits: 2})} (${percentError.toFixed(1)}%)`);
    console.log('');

    if (error < closest.error) {
      closest = { name: scenario.name, total, error };
    }
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`BEST MATCH: ${closest.name}`);
  console.log(`  Total PnL: $${closest.total.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Error: $${closest.error.toLocaleString('en-US', {minimumFractionDigits: 2})} (${((closest.error / polymarketPnL) * 100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  if (closest.error / polymarketPnL < 0.20) {
    console.log('✅ Including unrealized PnL gets us MUCH closer!');
    console.log('   Polymarket likely includes mark-to-market for open positions.');
  } else {
    console.log('❌ Even with unrealized PnL, still substantial error.');
    console.log('   The issue must be elsewhere.');
  }

  console.log('');

  // One more check: Are we using the wrong formula for some positions?
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('ADDITIONAL CHECK: Position-level analysis');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const detailQuery = `
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
      p.net_shares > 0 AS is_long,
      count() AS position_count,
      sum(abs(p.net_cost)) AS total_volume
    FROM positions p
    INNER JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator > 0
    GROUP BY is_long
  `;

  const detailResult = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
  const details = await detailResult.json<any[]>();

  console.log('Position types (resolved only):');
  details.forEach(d => {
    const type = d.is_long ? 'LONG (bought)' : 'SHORT (sold)';
    console.log(`  ${type}: ${d.position_count} positions, $${Number(d.total_volume).toLocaleString()} volume`);
  });
  console.log('');
}

analyzePnLComponents().catch(console.error);
