/**
 * Verify Backfill Completion
 *
 * Comprehensive validation of payout backfill results
 * Checks data quality, coverage, and readiness for production
 *
 * USAGE:
 *   npx tsx verify-backfill-completion.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import * as fs from 'fs';
import { clickhouse } from '@/lib/clickhouse/client';

interface ValidationResult {
  name: string;
  passed: boolean;
  details: string[];
  warnings: string[];
}

const results: ValidationResult[] = [];

function addResult(name: string, passed: boolean, details: string[], warnings: string[] = []) {
  results.push({ name, passed, details, warnings });
}

async function checkTotalPayouts() {
  console.log('\n1️⃣  Checking total payouts inserted...');

  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id) as unique_conditions
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
      FORMAT JSONEachRow
    `,
  });

  const data = await result.json<{ total_rows: string; unique_conditions: string }>();
  const totalRows = parseInt(data[0].total_rows);
  const uniqueConditions = parseInt(data[0].unique_conditions);

  const details = [
    `Total rows: ${totalRows.toLocaleString()}`,
    `Unique conditions: ${uniqueConditions.toLocaleString()}`,
  ];

  const warnings = [];

  // Expected: 120k-150k payouts (not all 170k markets are resolved)
  if (uniqueConditions < 100000) {
    warnings.push(`Low coverage: Expected 100k+ conditions, got ${uniqueConditions.toLocaleString()}`);
  }

  if (totalRows !== uniqueConditions) {
    details.push(`Duplicates: ${(totalRows - uniqueConditions).toLocaleString()} (will be deduplicated by ReplacingMergeTree)`);
  }

  const passed = uniqueConditions > 10000; // At least some data
  addResult('Total Payouts', passed, details, warnings);

  console.log(`   Total: ${totalRows.toLocaleString()}`);
  console.log(`   Unique: ${uniqueConditions.toLocaleString()}`);
  console.log(`   ${passed ? '✅' : '❌'} ${passed ? 'PASS' : 'FAIL'}`);
}

async function checkPayoutFormats() {
  console.log('\n2️⃣  Checking payout formats...');

  const result = await clickhouse.query({
    query: `
      SELECT
        payout_denominator,
        COUNT(*) as count,
        arraySum(payout_numerators) as sum_numerators
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
      GROUP BY payout_denominator, sum_numerators
      ORDER BY count DESC
      LIMIT 10
      FORMAT JSONEachRow
    `,
  });

  const data = await result.json<{
    payout_denominator: string;
    count: string;
    sum_numerators: string;
  }>();

  const details = [];
  const warnings = [];
  let hasInvalidSums = false;

  for (const row of data) {
    const denom = parseInt(row.payout_denominator);
    const sum = parseInt(row.sum_numerators);
    const count = parseInt(row.count);

    const valid = sum === denom;
    details.push(`Denominator ${denom}, sum ${sum}: ${count.toLocaleString()} payouts ${valid ? '✅' : '❌'}`);

    if (!valid) {
      hasInvalidSums = true;
      warnings.push(`Invalid sum: ${sum} !== ${denom} (${count.toLocaleString()} payouts)`);
    }
  }

  const passed = !hasInvalidSums;
  addResult('Payout Formats', passed, details, warnings);

  console.log(`   Formats found: ${data.length}`);
  console.log(`   ${passed ? '✅' : '❌'} ${passed ? 'All sums valid' : 'Some invalid sums'}`);
}

async function checkWinningIndices() {
  console.log('\n3️⃣  Checking winning indices...');

  const result = await clickhouse.query({
    query: `
      SELECT
        winning_index,
        COUNT(*) as count
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
      GROUP BY winning_index
      ORDER BY count DESC
      LIMIT 10
      FORMAT JSONEachRow
    `,
  });

  const data = await result.json<{ winning_index: string; count: string }>();

  const details = [];
  const warnings = [];
  let hasInvalidIndices = false;

  for (const row of data) {
    const index = parseInt(row.winning_index);
    const count = parseInt(row.count);

    details.push(`Index ${index}: ${count.toLocaleString()} payouts`);

    if (index < 0) {
      hasInvalidIndices = true;
      warnings.push(`Negative winning index: ${index} (${count.toLocaleString()} payouts)`);
    }
  }

  // Check for null/invalid indices
  const invalidResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
        AND (winning_index < 0 OR winning_index > 10)
      FORMAT JSONEachRow
    `,
  });

  const invalidData = await invalidResult.json<{ count: string }>();
  const invalidCount = parseInt(invalidData[0].count);

  if (invalidCount > 0) {
    hasInvalidIndices = true;
    warnings.push(`${invalidCount.toLocaleString()} payouts with invalid winning_index (< 0 or > 10)`);
  }

  const passed = !hasInvalidIndices;
  addResult('Winning Indices', passed, details, warnings);

  console.log(`   Index range: ${data.map(r => r.winning_index).join(', ')}`);
  console.log(`   ${passed ? '✅' : '❌'} ${passed ? 'All indices valid' : 'Some invalid indices'}`);
}

async function checkResolvedDates() {
  console.log('\n4️⃣  Checking resolved_at dates...');

  const result = await clickhouse.query({
    query: `
      SELECT
        MIN(resolved_at) as min_date,
        MAX(resolved_at) as max_date,
        COUNT(*) as total
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
      FORMAT JSONEachRow
    `,
  });

  const data = await result.json<{
    min_date: string;
    max_date: string;
    total: string;
  }>();

  const minDate = new Date(data[0].min_date);
  const maxDate = new Date(data[0].max_date);
  const total = parseInt(data[0].total);

  const details = [
    `Earliest: ${minDate.toISOString()}`,
    `Latest: ${maxDate.toISOString()}`,
    `Total: ${total.toLocaleString()}`,
  ];

  const warnings = [];

  // Check for future dates
  const now = new Date();
  if (maxDate > now) {
    warnings.push(`Found future dates: ${maxDate.toISOString()}`);
  }

  const passed = total > 0 && minDate < now;
  addResult('Resolved Dates', passed, details, warnings);

  console.log(`   Date range: ${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`);
  console.log(`   ${passed ? '✅' : '❌'} PASS`);
}

async function checkCoverageVsInput() {
  console.log('\n5️⃣  Checking coverage vs input file...');

  // Load input IDs
  const filePath = resolve(process.cwd(), 'reports/condition_ids_missing_api.txt');
  const content = fs.readFileSync(filePath, 'utf8');
  const inputIds = content.trim().split('\n');

  // Get inserted IDs
  const result = await clickhouse.query({
    query: `
      SELECT condition_id
      FROM default.resolutions_external_ingest
      WHERE source = 'goldsky-api'
      FORMAT JSONEachRow
    `,
  });

  const data = await result.json<{ condition_id: string }>();
  const insertedIds = new Set(data.map(r => r.condition_id));

  const foundCount = inputIds.filter(id => insertedIds.has(id)).length;
  const missedCount = inputIds.length - foundCount;
  const coveragePercent = (foundCount / inputIds.length) * 100;

  const details = [
    `Input IDs: ${inputIds.length.toLocaleString()}`,
    `Found payouts: ${foundCount.toLocaleString()} (${coveragePercent.toFixed(1)}%)`,
    `Not resolved: ${missedCount.toLocaleString()} (markets not resolved yet)`,
  ];

  const warnings = [];

  // It's normal for some markets to not be resolved yet
  if (coveragePercent < 50) {
    warnings.push(`Low resolution rate: ${coveragePercent.toFixed(1)}% - expected 60-80%`);
  }

  const passed = foundCount > 0;
  addResult('Coverage vs Input', passed, details, warnings);

  console.log(`   Coverage: ${coveragePercent.toFixed(1)}%`);
  console.log(`   ${passed ? '✅' : '❌'} PASS`);
}

async function checkWorkerCheckpoints() {
  console.log('\n6️⃣  Checking worker checkpoints...');

  const runtimeDir = resolve(process.cwd(), 'runtime');

  if (!fs.existsSync(runtimeDir)) {
    addResult('Worker Checkpoints', false, ['Runtime directory not found'], []);
    console.log('   ❌ No checkpoints found');
    return;
  }

  const files = fs.readdirSync(runtimeDir);
  const checkpointFiles = files.filter(f =>
    f.startsWith('payout-backfill-worker') && f.endsWith('.checkpoint.json')
  );

  const details = [`Found ${checkpointFiles.length} worker checkpoints`];
  const warnings = [];

  let totalProcessed = 0;
  let totalFound = 0;
  let totalErrors = 0;

  for (const file of checkpointFiles) {
    const path = resolve(runtimeDir, file);
    const content = fs.readFileSync(path, 'utf8');
    const checkpoint = JSON.parse(content);

    totalProcessed += checkpoint.totalIdsProcessed || 0;
    totalFound += checkpoint.totalPayoutsFound || 0;
    totalErrors += checkpoint.totalErrors || 0;

    details.push(
      `Worker ${checkpoint.workerNum}: ${(checkpoint.totalIdsProcessed || 0).toLocaleString()} IDs, ${(checkpoint.totalPayoutsFound || 0).toLocaleString()} payouts, ${checkpoint.totalErrors || 0} errors`
    );
  }

  details.push(`Total: ${totalProcessed.toLocaleString()} IDs, ${totalFound.toLocaleString()} payouts, ${totalErrors} errors`);

  if (totalErrors > totalProcessed * 0.01) {
    warnings.push(`High error rate: ${((totalErrors / totalProcessed) * 100).toFixed(1)}%`);
  }

  const passed = checkpointFiles.length > 0 && totalProcessed > 0;
  addResult('Worker Checkpoints', passed, details, warnings);

  console.log(`   Workers: ${checkpointFiles.length}`);
  console.log(`   Total processed: ${totalProcessed.toLocaleString()}`);
  console.log(`   ${passed ? '✅' : '❌'} PASS`);
}

async function checkIntegrationReadiness() {
  console.log('\n7️⃣  Checking integration readiness...');

  // Check if vw_resolutions_truth exists
  const viewResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as exists
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND name = 'vw_resolutions_truth'
      FORMAT JSONEachRow
    `,
  });

  const viewData = await viewResult.json<{ exists: string }>();
  const viewExists = parseInt(viewData[0].exists) > 0;

  const details = [];
  const warnings = [];

  if (viewExists) {
    details.push('vw_resolutions_truth view exists ✅');

    // Check if it includes goldsky data
    const unionResult = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM cascadian_clean.vw_resolutions_truth
        WHERE resolution_source = 'goldsky-api'
        FORMAT JSONEachRow
      `,
    });

    const unionData = await unionResult.json<{ count: string }>();
    const goldskyInView = parseInt(unionData[0].count);

    if (goldskyInView > 0) {
      details.push(`Goldsky data in view: ${goldskyInView.toLocaleString()} ✅`);
    } else {
      warnings.push('vw_resolutions_truth does not include Goldsky data yet - needs update');
      details.push('Update view with: See BACKFILL_PAYOUTS_GUIDE.md "Integration with P&L System"');
    }
  } else {
    warnings.push('vw_resolutions_truth view does not exist - may need to be created');
  }

  const passed = viewExists;
  addResult('Integration Readiness', passed, details, warnings);

  console.log(`   ${passed ? '✅' : '❌'} ${passed ? 'Ready for integration' : 'Needs setup'}`);
}

function printSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80) + '\n');

  let allPassed = true;

  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${result.name}`);

    if (result.details.length > 0) {
      result.details.forEach(d => console.log(`     ${d}`));
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach(w => console.log(`     ⚠️  ${w}`));
    }

    console.log('');

    if (!result.passed) allPassed = false;
  }

  console.log('='.repeat(80));

  if (allPassed) {
    console.log('✅ BACKFILL VALIDATION PASSED\n');
    console.log('Next steps:');
    console.log('1. Update vw_resolutions_truth view (see BACKFILL_PAYOUTS_GUIDE.md)');
    console.log('2. Verify P&L impact:');
    console.log('   SELECT COUNT(*) FROM cascadian_clean.vw_wallet_pnl_settled WHERE settled_pnl_usd != 0');
    console.log('3. Monitor for data quality issues\n');
  } else {
    console.log('❌ SOME VALIDATIONS FAILED\n');
    console.log('Review failures above and investigate before production use.\n');
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('PAYOUT BACKFILL VALIDATION');
  console.log('='.repeat(80));

  try {
    await checkTotalPayouts();
    await checkPayoutFormats();
    await checkWinningIndices();
    await checkResolvedDates();
    await checkCoverageVsInput();
    await checkWorkerCheckpoints();
    await checkIntegrationReadiness();

    printSummary();
  } catch (error) {
    console.error('\n❌ Validation error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
