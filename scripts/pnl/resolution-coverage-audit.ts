#!/usr/bin/env npx tsx
/**
 * RESOLUTION COVERAGE AUDIT
 *
 * Proves whether missing resolution coverage is a backfill problem or a mapping/view issue.
 */

import fs from 'fs/promises';
import { getClickHouseClient } from '../../lib/clickhouse/client';

const WALLET = process.env.WALLET || '0x7724f6f8023f40bc9ad3e4496449f5924fa56deb';

async function main() {
  const client = getClickHouseClient();
  const wallet = WALLET.toLowerCase();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('   RESOLUTION COVERAGE AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log(`Wallet: ${wallet}\n`);

  // Step 1: Extract condition_ids for this wallet
  console.log('Step 1: Extracting condition_ids from ledger...');
  const conditionQuery = `
    SELECT DISTINCT condition_id
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
    LIMIT 5000
  `;

  const conditionResult = await client.query({ query: conditionQuery, format: 'JSONEachRow' });
  const conditions = await conditionResult.json<Array<{ condition_id: string }>>();
  console.log(`  Found ${conditions.length} distinct condition_ids\n`);

  if (conditions.length === 0) {
    console.log('No conditions found. Exiting.');
    return;
  }

  const sampleConditions = conditions.slice(0, 200).map(c => c.condition_id);
  const inList = sampleConditions.map(c => `'${c}'`).join(',');

  // Step 2: Check condition_ids in various tables
  console.log('Step 2: Checking condition_ids in mapping tables...');
  const checks = [
    { table: 'pm_condition_resolutions', col: 'condition_id' },
    { table: 'pm_token_to_condition_map_v3', col: 'condition_id' },
    { table: 'pm_token_to_condition_map_v3', col: 'ctf_condition_id' },
    { table: 'pm_markets', col: 'condition_id' },
  ];

  const tableResults: Record<string, number> = {};

  for (const { table, col } of checks) {
    try {
      const q = `SELECT count() as c FROM ${table} WHERE ${col} IN (${inList})`;
      const r = await client.query({ query: q, format: 'JSONEachRow' });
      const data = await r.json<Array<{ c: string }>>();
      tableResults[`${table}.${col}`] = parseInt(data[0]?.c || '0');
      console.log(`  ${table}.${col}: ${tableResults[`${table}.${col}`]}`);
    } catch (e: any) {
      console.log(`  ${table}.${col}: ERROR - ${e.message}`);
      tableResults[`${table}.${col}`] = -1;
    }
  }

  // Step 3: Get view definition
  console.log('\nStep 3: Checking vw_pm_resolution_prices view...');
  try {
    const viewQuery = `SHOW CREATE VIEW vw_pm_resolution_prices`;
    const viewResult = await client.query({ query: viewQuery, format: 'JSONEachRow' });
    const viewData = await viewResult.json<Array<{ statement: string }>>();
    console.log('  View exists. Definition saved.');
    await fs.writeFile('tmp/create_view_vw_pm_resolution_prices.txt', JSON.stringify(viewData, null, 2));
  } catch (e: any) {
    console.log(`  View check failed: ${e.message}`);
  }

  // Step 4: Direct comparison - base table vs view
  console.log('\nStep 4: Comparing base table vs view hits...');

  let baseTableHits = 0;
  let viewHits = 0;

  try {
    const baseQuery = `
      SELECT count() as c
      FROM pm_condition_resolutions
      WHERE condition_id IN (${inList})
    `;
    const baseResult = await client.query({ query: baseQuery, format: 'JSONEachRow' });
    const baseData = await baseResult.json<Array<{ c: string }>>();
    baseTableHits = parseInt(baseData[0]?.c || '0');
    console.log(`  pm_condition_resolutions (base): ${baseTableHits}`);
  } catch (e: any) {
    console.log(`  pm_condition_resolutions: ERROR - ${e.message}`);
  }

  try {
    const viewQuery = `
      SELECT count() as c
      FROM vw_pm_resolution_prices
      WHERE condition_id IN (${inList})
    `;
    const viewResult = await client.query({ query: viewQuery, format: 'JSONEachRow' });
    const viewData = await viewResult.json<Array<{ c: string }>>();
    viewHits = parseInt(viewData[0]?.c || '0');
    console.log(`  vw_pm_resolution_prices (view): ${viewHits}`);
  } catch (e: any) {
    console.log(`  vw_pm_resolution_prices: ERROR - ${e.message}`);
  }

  // Step 5: Diagnosis
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                    DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const totalConditions = sampleConditions.length;
  const baseHitRate = (baseTableHits / totalConditions * 100).toFixed(1);
  const viewHitRate = (viewHits / totalConditions * 100).toFixed(1);

  console.log(`  Sample size: ${totalConditions} conditions`);
  console.log(`  Base table hit rate: ${baseHitRate}%`);
  console.log(`  View hit rate: ${viewHitRate}%`);
  console.log();

  if (baseTableHits > viewHits * 2) {
    console.log('  ⚠️  VIEW BUG DETECTED: Base table has significantly more hits than view.');
    console.log('     The view join logic or filter is incorrectly excluding valid resolutions.');
  } else if (baseTableHits === 0 && tableResults['pm_token_to_condition_map_v3.ctf_condition_id'] > 0) {
    console.log('  ⚠️  NAMESPACE MISMATCH: Conditions exist in token_map under ctf_condition_id');
    console.log('     but not under condition_id. The ledger uses a different condition_id namespace.');
  } else if (baseTableHits === 0 && tableResults['pm_token_to_condition_map_v3.condition_id'] > 0) {
    console.log('  ⚠️  RESOLUTION DATA MISSING: Conditions exist in token_map but not in resolutions.');
    console.log('     May need to backfill pm_condition_resolutions from CTF events.');
  } else if (baseTableHits > 0 && viewHits > 0 && baseTableHits === viewHits) {
    console.log('  ✅ VIEW WORKING CORRECTLY: Base table and view show same hit counts.');
    console.log('     Resolution coverage is genuine (some conditions unresolved).');
  } else {
    console.log('  ❓ UNCLEAR: Further investigation needed.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════\n');

  // Save results
  const report = {
    wallet,
    timestamp: new Date().toISOString(),
    sampleSize: totalConditions,
    totalConditions: conditions.length,
    tableResults,
    baseTableHits,
    viewHits,
    baseHitRate: parseFloat(baseHitRate),
    viewHitRate: parseFloat(viewHitRate),
    sampleConditionIds: sampleConditions.slice(0, 10),
  };

  await fs.writeFile('tmp/resolution_coverage_audit.json', JSON.stringify(report, null, 2));
  console.log('Results saved to tmp/resolution_coverage_audit.json');
}

main().catch(console.error);
