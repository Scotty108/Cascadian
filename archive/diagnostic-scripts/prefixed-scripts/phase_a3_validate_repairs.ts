#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE A.3: Validate Repair Quality');
  console.log('═══════════════════════════════════════════════════════════\n');

  let allChecksPassed = true;

  console.log('Check 1: Format validation...\n');
  
  const formatCheck = `
    SELECT
      countIf(length(repair_condition_id) != 64) AS wrong_length,
      countIf(repair_condition_id LIKE '%0x%') AS has_prefix,
      countIf(repair_condition_id != lower(repair_condition_id)) AS not_lowercase,
      countIf(repair_condition_id = '0000000000000000000000000000000000000000000000000000000000000000') AS zero_id,
      count() AS total
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
  `;

  const formatResult = await clickhouse.query({ query: formatCheck, format: 'JSONEachRow' });
  const formatData = await formatResult.json<any>();
  
  console.log('Format validation results:');
  console.log(JSON.stringify(formatData, null, 2));
  
  const formatIssues = formatData[0].wrong_length + formatData[0].has_prefix + 
                       formatData[0].not_lowercase + formatData[0].zero_id;
  
  if (formatIssues > 0) {
    console.log('❌ FAILED: Format issues detected');
    allChecksPassed = false;
  } else {
    console.log('✅ PASSED: All formats valid');
  }

  console.log('\nCheck 2: Uniqueness validation...\n');
  
  const uniquenessCheck = `
    SELECT transaction_hash, count() AS repair_count
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
    GROUP BY transaction_hash
    HAVING repair_count > 1
    LIMIT 5
  `;

  const uniqueResult = await clickhouse.query({ query: uniquenessCheck, format: 'JSONEachRow' });
  const uniqueData = await uniqueResult.json<any>();
  
  if (uniqueData.length > 0) {
    console.log('❌ FAILED: Duplicate repairs found');
    console.log(JSON.stringify(uniqueData, null, 2));
    allChecksPassed = false;
  } else {
    console.log('✅ PASSED: All repairs are unique (1:1)');
  }

  console.log('\nCheck 3: Market existence validation...\n');
  
  const marketCheck = `
    SELECT
      count() AS total_repairs,
      countIf(repair_condition_id IN (SELECT DISTINCT condition_id FROM gamma_markets)) AS has_market,
      round(100.0 * has_market / total_repairs, 2) AS market_match_pct
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
  `;

  const marketResult = await clickhouse.query({ query: marketCheck, format: 'JSONEachRow' });
  const marketData = await marketResult.json<any>();
  
  console.log('Market existence results:');
  console.log(JSON.stringify(marketData, null, 2));
  
  if (marketData[0].market_match_pct < 95) {
    console.log(`⚠️  WARNING: Only ${marketData[0].market_match_pct}% have markets (expected >95%)`);
  } else {
    console.log('✅ PASSED: Market match rate acceptable');
  }

  console.log('\nCheck 4: Coverage gain measurement...\n');
  
  const coverageCheck = `
    SELECT
      (SELECT count() FROM tmp_v4_phase_a_test_month_orphans) AS total_orphans_202410,
      (SELECT count() FROM tmp_v4_phase_a_pm_trades_repairs_202410) AS repairs_found,
      round(100.0 * repairs_found / total_orphans_202410, 2) AS repair_coverage_pct
    FROM tmp_v4_phase_a_test_month_orphans
    LIMIT 1
  `;

  const coverageResult = await clickhouse.query({ query: coverageCheck, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json<any>();
  
  console.log('Coverage gain:');
  console.log(JSON.stringify(coverageData, null, 2));
  
  if (coverageData[0].repair_coverage_pct < 20 || coverageData[0].repair_coverage_pct > 40) {
    console.log(`⚠️  WARNING: Coverage ${coverageData[0].repair_coverage_pct}% outside expected range (20-40%)`);
  } else {
    console.log('✅ PASSED: Coverage gain within expected range');
  }

  console.log('\nCheck 5: Outcome index validation...\n');
  
  const outcomeCheck = `
    SELECT
      countIf(repair_outcome_index < 0) AS negative_index,
      countIf(repair_outcome_index > 10) AS suspiciously_high,
      min(repair_outcome_index) AS min_index,
      max(repair_outcome_index) AS max_index,
      count() AS total
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
  `;

  const outcomeResult = await clickhouse.query({ query: outcomeCheck, format: 'JSONEachRow' });
  const outcomeData = await outcomeResult.json<any>();
  
  console.log('Outcome index results:');
  console.log(JSON.stringify(outcomeData, null, 2));
  
  if (outcomeData[0].negative_index > 0) {
    console.log('❌ FAILED: Negative outcome indices detected');
    allChecksPassed = false;
  } else {
    console.log('✅ PASSED: Outcome indices valid');
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  if (allChecksPassed) {
    console.log('✅ ALL VALIDATION CHECKS PASSED');
    console.log('DECISION: PROCEED TO GLOBAL SCALING (Phase A.4)');
  } else {
    console.log('❌ VALIDATION FAILED');
    console.log('DECISION: DO NOT PROCEED - Fix issues first');
  }
  console.log('═══════════════════════════════════════════════════════════');
  
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch(console.error);
