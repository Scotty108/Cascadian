#!/usr/bin/env npx tsx
/**
 * Debug Resolution Loading
 *
 * Investigates why resolution prices might be returning 0.5 instead of actual payouts.
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const wallet = '0x569e2cb3cc89b7afb28f79a262aae30da6cb4175';

  console.log(`Checking resolution data for wallet: ${wallet}\n`);

  // Get condition IDs from their trades
  const conditions = await clickhouse.query({
    query: `
      SELECT DISTINCT
        m.condition_id,
        m.outcome_index
      FROM (
        SELECT any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) fills
      INNER JOIN pm_token_to_condition_map_v5 m ON fills.token_id = m.token_id_dec
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const condRows = await conditions.json() as any[];
  console.log(`Found ${condRows.length} sample conditions from wallet trades:\n`);

  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const c of condRows) {
    // Check if resolved
    const res = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE lower(condition_id) = lower('${c.condition_id}')
      `,
      format: 'JSONEachRow'
    });
    const resRows = await res.json() as any[];

    if (resRows.length > 0) {
      resolvedCount++;
      const payoutsRaw = resRows[0].payout_numerators;
      const payouts = JSON.parse(payoutsRaw);
      const outcomeIdx = Number(c.outcome_index);
      const payout = payouts[outcomeIdx];

      console.log(`  ✓ ${c.condition_id.slice(0,20)}...`);
      console.log(`    outcome_index: ${outcomeIdx}`);
      console.log(`    payout_numerators: ${payoutsRaw}`);
      console.log(`    payout for this outcome: ${payout}`);
      console.log('');
    } else {
      unresolvedCount++;
      console.log(`  ✗ ${c.condition_id.slice(0,20)}... NOT RESOLVED`);
      console.log('');
    }
  }

  console.log(`\nSummary: ${resolvedCount} resolved, ${unresolvedCount} unresolved\n`);

  // Now test the V11 resolution loading mechanism
  console.log('='.repeat(60));
  console.log('Testing V11 Resolution Loading Mechanism');
  console.log('='.repeat(60));

  const result = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions LIMIT 5`,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  console.log('\nRaw rows from query:');
  for (const r of rows) {
    console.log(`  condition_id type: ${typeof r.condition_id}`);
    console.log(`  payout_numerators type: ${typeof r.payout_numerators}`);
    console.log(`  payout_numerators value: ${r.payout_numerators}`);

    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    console.log(`  parsed payouts: [${payouts.join(', ')}]`);
    console.log('');
  }

  // Check total resolution coverage
  const totalRes = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_condition_resolutions`,
    format: 'JSONEachRow',
  });
  const totalResRows = await totalRes.json() as any[];
  console.log(`Total resolutions in pm_condition_resolutions: ${totalResRows[0].cnt}`);

  // Compare with vw_resolution_prices_v2 if it exists
  try {
    const vwRes = await clickhouse.query({
      query: `SELECT count() as cnt FROM vw_resolution_prices_v2`,
      format: 'JSONEachRow',
    });
    const vwResRows = await vwRes.json() as any[];
    console.log(`Total in vw_resolution_prices_v2: ${vwResRows[0].cnt}`);
  } catch (e) {
    console.log('vw_resolution_prices_v2 not found');
  }
}

main().catch(console.error);
