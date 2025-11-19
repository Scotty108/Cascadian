import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkUnresolvedPositions() {
  console.log('=== Investigating Positions with Invalid Resolution Data ===\n');

  // Get positions with invalid or missing resolution data
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
        AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      p.condition_id,
      p.outcome_idx,
      p.net_shares,
      p.net_cost,
      p.trade_count,
      r.payout_denominator,
      r.winning_index,
      r.resolved_at,
      r.updated_at
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
    ORDER BY abs(net_cost) DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = await result.json<any[]>();

  console.log(`Found ${positions.length} positions with invalid/missing resolution data\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  let totalCostAtRisk = 0;

  positions.forEach((pos, i) => {
    console.log(`\n[${i + 1}] Position:`);
    console.log(`  Condition ID: ${pos.condition_id}`);
    console.log(`  Outcome Index: ${pos.outcome_idx}`);
    console.log(`  Net Shares: ${Number(pos.net_shares).toFixed(2)}`);
    console.log(`  Net Cost: $${Number(pos.net_cost).toFixed(2)}`);
    console.log(`  Trade Count: ${pos.trade_count}`);
    console.log(`  Resolution Status: ${pos.payout_denominator === null ? 'Not found' : `Found (denom=${pos.payout_denominator})`}`);
    if (pos.resolved_at) {
      console.log(`  Resolved At: ${pos.resolved_at}`);
    }
    if (pos.updated_at) {
      console.log(`  Updated At: ${pos.updated_at}`);
    }

    totalCostAtRisk += Math.abs(Number(pos.net_cost));
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('\nSUMMARY:');
  console.log(`  Positions with invalid resolution: ${positions.length}`);
  console.log(`  Total cost at risk: $${totalCostAtRisk.toFixed(2)}`);
  console.log('');

  // Now check: are these positions truly unresolved, or do they have resolution data elsewhere?
  console.log('Checking if these condition IDs exist in market_resolutions_final at all...\n');

  const conditionIds = positions.slice(0, 10).map(p => `'${p.condition_id}'`).join(',');

  const checkQuery = `
    SELECT
      condition_id_norm,
      payout_numerators,
      payout_denominator,
      winning_outcome,
      resolved_at
    FROM market_resolutions_final
    WHERE condition_id_norm IN (${conditionIds})
  `;

  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const resolutions = await checkResult.json<any[]>();

  console.log(`Found ${resolutions.length} resolutions for first 10 positions:`);
  resolutions.forEach(res => {
    console.log(`  ${res.condition_id_norm}: denom=${res.payout_denominator}, winner=${res.winning_outcome}`);
  });
  console.log('');

  // Key insight check
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('KEY INSIGHT:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('If these 83 positions have payout_denominator = 0, it means:');
  console.log('  1. They are truly unresolved (market still open)');
  console.log('  2. OR resolution data exists but has invalid payout (0/0)');
  console.log('  3. OR there is a data quality issue in market_resolutions_final');
  console.log('');
  console.log('These positions represent unrealized PnL that is NOT being counted.');
  console.log('If the wallet held WINNING positions that are still open or have invalid');
  console.log('resolution data, this could explain the $494k discrepancy!');
  console.log('');

  // Calculate what the PnL would be if ALL unresolved positions were winners
  const hypotheticalPnL = totalCostAtRisk; // Assume they all double (bought at 50% avg)
  console.log(`Hypothetical scenario: If all unresolved positions won at 100%:`);
  console.log(`  Potential profit: $${hypotheticalPnL.toFixed(2)}`);
  console.log('');
}

checkUnresolvedPositions().catch(console.error);
