/**
 * 40: VERIFY TRACK A FIXTURE
 *
 * Sanity check that fixture_track_a_final.json is structurally correct
 * and status calculations match expectations
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const SNAPSHOT_TS = '2025-10-15 00:00:00';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('40: VERIFY TRACK A FIXTURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Snapshot timestamp: ${SNAPSHOT_TS}\n`);

  // Load fixture
  const fixturePath = resolve(process.cwd(), 'fixture_track_a_final.json');
  const fixtureData = readFileSync(fixturePath, 'utf-8');
  const fixture: any[] = JSON.parse(fixtureData);

  console.log(`Loaded ${fixture.length} rows from fixture\n`);

  // Basic structure assertions
  console.log('📊 Step 1: Basic structure validation...\n');

  const wonCount = fixture.filter(f => f.status === 'WON').length;
  const lostCount = fixture.filter(f => f.status === 'LOST').length;
  const openCount = fixture.filter(f => f.status === 'OPEN').length;

  console.log('Counts by status:');
  console.table([
    { status: 'WON', count: wonCount },
    { status: 'LOST', count: lostCount },
    { status: 'OPEN', count: openCount },
    { status: 'TOTAL', count: fixture.length }
  ]);

  const assertions = [
    { name: 'Exactly 15 rows', pass: fixture.length === 15 },
    { name: '5 WON rows', pass: wonCount === 5 },
    { name: '5 LOST rows', pass: lostCount === 5 },
    { name: '5 OPEN rows', pass: openCount === 5 }
  ];

  console.log('\nBasic assertions:');
  console.table(assertions);

  const basicPass = assertions.every(a => a.pass);

  if (!basicPass) {
    console.log('\n❌ FAILED: Basic structure validation\n');
    return;
  }

  console.log('\n✅ Basic structure validation passed\n');

  // Field validation
  console.log('📊 Step 2: Field validation...\n');

  let fieldErrors = 0;

  fixture.forEach((row, i) => {
    const errors: string[] = [];

    if (!row.wallet) errors.push('Missing wallet');
    if (!row.asset_id) errors.push('Missing asset_id');
    // Note: condition_id_norm might be missing, we'll look it up from ctf_token_map
    if (!row.outcome_label) errors.push('Missing outcome_label');

    if (row.status === 'WON' || row.status === 'LOST') {
      if (row.winning_index === null || row.winning_index === undefined) {
        errors.push('Missing winning_index for resolved position');
      }
      if (!row.resolved_at) errors.push('Missing resolved_at for resolved position');
      if (row.realized_pnl === null || row.realized_pnl === undefined) {
        errors.push('Missing realized_pnl for resolved position');
      }
    }

    if (errors.length > 0) {
      console.log(`Row ${i} (${row.status}): ${errors.join(', ')}`);
      fieldErrors += errors.length;
    }
  });

  if (fieldErrors > 0) {
    console.log(`\n❌ FAILED: ${fieldErrors} field validation errors\n`);
    return;
  }

  console.log('✅ All fields validated\n');

  // Status verification against ClickHouse
  console.log('📊 Step 3: Verify status calculations...\n');

  let statusPassed = 0;
  let statusFailed = 0;

  for (const row of fixture) {
    if (row.status === 'OPEN') {
      // Open positions don't need verification
      statusPassed++;
      continue;
    }

    // First lookup condition_id_norm from ctf_token_map using asset_id
    const queryMap = await clickhouse.query({
      query: `
        SELECT condition_id_norm
        FROM ctf_token_map
        WHERE token_id = '${row.asset_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const mapResults: any[] = await queryMap.json();
    if (mapResults.length === 0) {
      console.log(`  ⚠️  Row ${row.wallet.substring(0, 10)}... (${row.status}): No ctf_token_map entry for asset_id`);
      statusFailed++;
      continue;
    }

    const conditionIdNorm = mapResults[0].condition_id_norm;

    // Query ClickHouse for resolution data
    const query = await clickhouse.query({
      query: `
        SELECT
          winning_index,
          resolved_at,
          payout_numerators
        FROM market_resolutions_final
        WHERE condition_id_norm = '${conditionIdNorm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const results: any[] = await query.json();

    if (results.length === 0) {
      console.log(`  ⚠️  Row ${row.wallet.substring(0, 10)}... (${row.status}): No resolution found in DB`);
      statusFailed++;
      continue;
    }

    const dbResolution = results[0];

    // Determine expected status
    const outcomeIndex = row.outcome_label === 'Yes' || row.outcome_label === 'Up' ? 0 : 1;
    const isWinner = parseInt(dbResolution.winning_index) === outcomeIndex;
    const resolvedBeforeSnapshot = new Date(dbResolution.resolved_at) <= new Date(SNAPSHOT_TS);

    let expectedStatus: string;
    if (!resolvedBeforeSnapshot) {
      expectedStatus = 'OPEN';
    } else if (isWinner) {
      expectedStatus = 'WON';
    } else {
      expectedStatus = 'LOST';
    }

    if (expectedStatus === row.status) {
      statusPassed++;
    } else {
      console.log('\n❌ FAILING ROW DETAILS:');
      console.log('════════════════════════════════════════════════════════════');
      console.log(`Wallet: ${row.wallet}`);
      console.log(`Asset ID: ${row.asset_id}`);
      console.log(`Condition ID: ${conditionIdNorm}`);
      console.log(`Outcome label: ${row.outcome_label}`);
      console.log(`Outcome index (computed): ${outcomeIndex}`);
      console.log('');
      console.log('Fixture says:');
      console.log(`  Status: ${row.status}`);
      console.log(`  Winning index: ${row.winning_index}`);
      console.log(`  Resolved at: ${row.resolved_at}`);
      console.log('');
      console.log('Database says:');
      console.log(`  Winning index: ${dbResolution.winning_index}`);
      console.log(`  Resolved at: ${dbResolution.resolved_at}`);
      console.log(`  Payout numerators: [${dbResolution.payout_numerators.join(', ')}]`);
      console.log('');
      console.log('Validation logic:');
      console.log(`  Resolved before snapshot (${SNAPSHOT_TS}): ${resolvedBeforeSnapshot}`);
      console.log(`  Is winner (outcome_index=${outcomeIndex} == winning_index=${dbResolution.winning_index}): ${isWinner}`);
      console.log(`  Expected status: ${expectedStatus}`);
      console.log('');
      console.log('Why it fails:');
      if (!resolvedBeforeSnapshot && row.status !== 'OPEN') {
        console.log(`  ❌ Resolved after snapshot but fixture status is ${row.status}, should be OPEN`);
      } else if (resolvedBeforeSnapshot && isWinner && row.status !== 'WON') {
        console.log(`  ❌ Resolved before snapshot and is winner but fixture status is ${row.status}, should be WON`);
      } else if (resolvedBeforeSnapshot && !isWinner && row.status !== 'LOST') {
        console.log(`  ❌ Resolved before snapshot and is loser but fixture status is ${row.status}, should be LOST`);
      }
      console.log('');
      console.log('Full fixture row:');
      console.log(JSON.stringify(row, null, 2));
      console.log('════════════════════════════════════════════════════════════\n');
      statusFailed++;
    }
  }

  console.log('\nStatus verification results:');
  console.table([
    { result: 'Passed', count: statusPassed },
    { result: 'Failed', count: statusFailed }
  ]);

  // Final summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total rows: ${fixture.length}`);
  console.log(`Basic structure: ${basicPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Field validation: ${fieldErrors === 0 ? '✅ PASS' : '❌ FAIL'} (${fieldErrors} errors)`);
  console.log(`Status verification: ${statusFailed === 0 ? '✅ PASS' : '❌ FAIL'} (${statusFailed} mismatches)`);
  console.log('');

  if (basicPass && fieldErrors === 0 && statusFailed === 0) {
    console.log('✅ ALL CHECKS PASSED - Fixture is valid!\n');
  } else {
    console.log('❌ SOME CHECKS FAILED - Review errors above\n');
  }
}

main().catch(console.error);
