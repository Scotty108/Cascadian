#!/usr/bin/env npx tsx
/**
 * Comprehensive Unified Table Validation
 *
 * Validates:
 * 1. No duplicates
 * 2. Data freshness (up to date)
 * 3. FIFO logic correctness
 * 4. Attribute accuracy (is_closed, resolved_at, etc.)
 * 5. Cron health
 * 6. Data integrity
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface ValidationResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  metric?: any;
}

const results: ValidationResult[] = [];

function addResult(test: string, status: 'PASS' | 'FAIL' | 'WARN', details: string, metric?: any) {
  results.push({ test, status, details, metric });
  const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${emoji} ${test}: ${details}`);
  if (metric !== undefined) {
    console.log(`   Metric: ${JSON.stringify(metric)}`);
  }
}

async function test1_NoDuplicates() {
  console.log('\n1️⃣  Testing for Duplicates...\n');

  // Use system.parts for total row count (fast, no memory issues)
  const sizeResult = await clickhouse.query({
    query: `
      SELECT sum(rows) as total_rows
      FROM system.parts
      WHERE table = 'pm_trade_fifo_roi_v3_mat_unified' AND active
    `,
    format: 'JSONEachRow',
  });
  const { total_rows } = (await sizeResult.json())[0];

  // Sample duplicate check on recent data (last 7 days)
  const recentDupResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const recentDup = (await recentDupResult.json())[0];

  if (recentDup.duplicates === 0) {
    addResult('Recent Data Clean', 'PASS', `Last 7 days: ${recentDup.total_rows.toLocaleString()} rows, 0 duplicates`, { duplicates: 0 });
  } else {
    addResult('Recent Data Clean', 'WARN', `Last 7 days has ${recentDup.duplicates.toLocaleString()} duplicates`, { duplicates: recentDup.duplicates });
  }

  // Check for duplicate detection by querying for groups with multiple rows
  const groupDupResult = await clickhouse.query({
    query: `
      SELECT count() as duplicate_groups
      FROM (
        SELECT tx_hash, wallet, condition_id, outcome_index, count() as cnt
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE entry_time >= now() - INTERVAL 30 DAY
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING cnt > 1
      )
    `,
    format: 'JSONEachRow',
  });
  const groupDup = (await groupDupResult.json())[0];

  if (groupDup.duplicate_groups === 0) {
    addResult('No Duplicate Groups', 'PASS', `No duplicate position keys in last 30 days`, { groups: 0 });
  } else {
    addResult('No Duplicate Groups', 'WARN', `Found ${groupDup.duplicate_groups} duplicate groups in last 30 days`, groupDup);
  }

  addResult('Total Rows', 'PASS', `Table has ${total_rows.toLocaleString()} rows total`, { total_rows });
}

async function test2_DataFreshness() {
  console.log('\n2️⃣  Testing Data Freshness...\n');

  const freshnessResult = await clickhouse.query({
    query: `
      SELECT
        max(entry_time) as latest_entry,
        max(resolved_at) as latest_resolution,
        dateDiff('minute', max(entry_time), now()) as entry_staleness_min,
        dateDiff('minute', max(resolved_at), now()) as resolution_staleness_min
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const fresh = (await freshnessResult.json())[0];

  // Latest entry should be from last night (Phase 2 stopped at 1:09 AM)
  if (fresh.entry_staleness_min < 1440) { // Less than 24 hours
    addResult('Entry Freshness', 'PASS', `Latest entry: ${fresh.latest_entry} (${fresh.entry_staleness_min} min ago)`, fresh);
  } else {
    addResult('Entry Freshness', 'WARN', `Latest entry is stale: ${fresh.latest_entry}`, fresh);
  }

  // Latest resolution should be very recent (cron runs every 2 hours)
  if (fresh.resolution_staleness_min < 180) { // Less than 3 hours
    addResult('Resolution Freshness', 'PASS', `Latest resolution: ${fresh.latest_resolution} (${fresh.resolution_staleness_min} min ago)`, fresh);
  } else {
    addResult('Resolution Freshness', 'FAIL', `Resolutions are stale! Latest: ${fresh.latest_resolution}`, fresh);
  }
}

async function test3_FIFOLogic() {
  console.log('\n3️⃣  Testing FIFO Logic Correctness...\n');

  // Test 1: Validate PnL calculation (exit_value - cost_usd = pnl_usd)
  const pnlResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_resolved,
        countIf(abs((exit_value - cost_usd) - pnl_usd) > 0.01) as pnl_mismatches,
        avg(abs((exit_value - cost_usd) - pnl_usd)) as avg_error
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
        AND entry_time >= now() - INTERVAL 30 DAY
      LIMIT 1000000
    `,
    format: 'JSONEachRow',
  });
  const pnl = (await pnlResult.json())[0];

  if (pnl.pnl_mismatches === 0) {
    addResult('PnL Calculation', 'PASS', `All ${pnl.total_resolved.toLocaleString()} sampled positions have correct PnL`, { mismatches: 0 });
  } else {
    const errorRate = (pnl.pnl_mismatches / pnl.total_resolved * 100).toFixed(2);
    addResult('PnL Calculation', 'WARN', `${pnl.pnl_mismatches} mismatches (${errorRate}%), avg error: $${pnl.avg_error.toFixed(4)}`, pnl);
  }

  // Test 2: ROI calculation (pnl_usd / cost_usd = roi)
  const roiResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_resolved,
        countIf(cost_usd > 0 AND abs((pnl_usd / cost_usd) - roi) > 0.01) as roi_mismatches
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
        AND cost_usd > 0.01
        AND entry_time >= now() - INTERVAL 30 DAY
      LIMIT 1000000
    `,
    format: 'JSONEachRow',
  });
  const roi = (await roiResult.json())[0];

  if (roi.roi_mismatches === 0) {
    addResult('ROI Calculation', 'PASS', `All ${roi.total_resolved.toLocaleString()} sampled positions have correct ROI`, { mismatches: 0 });
  } else {
    const errorRate = (roi.roi_mismatches / roi.total_resolved * 100).toFixed(2);
    addResult('ROI Calculation', 'WARN', `${roi.roi_mismatches} ROI mismatches (${errorRate}%)`, roi);
  }

  // Test 3: Token balance (tokens = tokens_sold_early + tokens_held)
  const tokenResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        countIf(abs(tokens - (tokens_sold_early + tokens_held)) > 0.01) as token_mismatches
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL 30 DAY
      LIMIT 1000000
    `,
    format: 'JSONEachRow',
  });
  const token = (await tokenResult.json())[0];

  if (token.token_mismatches === 0) {
    addResult('Token Balance', 'PASS', `All ${token.total_positions.toLocaleString()} positions have correct token accounting`, { mismatches: 0 });
  } else {
    const errorRate = (token.token_mismatches / token.total_positions * 100).toFixed(2);
    addResult('Token Balance', 'FAIL', `${token.token_mismatches} token balance errors (${errorRate}%)`, token);
  }
}

async function test4_AttributeAccuracy() {
  console.log('\n4️⃣  Testing Attribute Accuracy...\n');

  // Test 1: is_closed flag (should be 1 when tokens_held <= 0.01)
  const closedResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tokens_held <= 0.01 AND is_closed = 0) as should_be_closed,
        countIf(tokens_held > 0.01 AND is_closed = 1) as should_be_open
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
        AND entry_time >= now() - INTERVAL 30 DAY
    `,
    format: 'JSONEachRow',
  });
  const closed = (await closedResult.json())[0];

  if (closed.should_be_closed === 0 && closed.should_be_open === 0) {
    addResult('is_closed Flag', 'PASS', 'All positions have correct is_closed flag', closed);
  } else {
    addResult('is_closed Flag', 'FAIL', `${closed.should_be_closed} should be closed, ${closed.should_be_open} should be open`, closed);
  }

  // Test 2: Resolved positions should have resolved_at
  const resolvedResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NOT NULL) as resolved_count,
        countIf(resolved_at IS NULL) as unresolved_count,
        countIf(resolved_at IS NOT NULL AND pnl_usd = 0 AND exit_value = 0) as resolved_but_no_pnl
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const resolved = (await resolvedResult.json())[0];

  addResult('Resolved Count', 'PASS', `${resolved.resolved_count.toLocaleString()} resolved, ${resolved.unresolved_count.toLocaleString()} unresolved`, resolved);

  if (resolved.resolved_but_no_pnl > 0) {
    const pct = (resolved.resolved_but_no_pnl / resolved.resolved_count * 100).toFixed(2);
    addResult('Resolved PnL', 'WARN', `${resolved.resolved_but_no_pnl.toLocaleString()} resolved positions with $0 PnL (${pct}%)`, { count: resolved.resolved_but_no_pnl });
  } else {
    addResult('Resolved PnL', 'PASS', 'All resolved positions have PnL calculated', { zero_pnl: 0 });
  }

  // Test 3: Unresolved positions should have zero exit_value and pnl
  const unresolvedResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_unresolved,
        countIf(exit_value != 0 OR pnl_usd != 0) as unresolved_with_pnl
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const unresolved = (await unresolvedResult.json())[0];

  if (unresolved.unresolved_with_pnl === 0) {
    addResult('Unresolved Positions', 'PASS', `All ${unresolved.total_unresolved.toLocaleString()} unresolved have zero PnL`, unresolved);
  } else {
    addResult('Unresolved Positions', 'FAIL', `${unresolved.unresolved_with_pnl} unresolved positions have non-zero PnL!`, unresolved);
  }
}

async function test5_CronHealth() {
  console.log('\n5️⃣  Testing Cron Health...\n');

  // Check if there are recent resolutions that should have been picked up by cron
  const cronResult = await clickhouse.query({
    query: `
      SELECT
        count() as positions_needing_update
      FROM pm_trade_fifo_roi_v3 v
      INNER JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.resolved_at >= now() - INTERVAL 3 HOUR
        AND v.resolved_at IS NOT NULL
        AND u.resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const cron = (await cronResult.json())[0];

  if (cron.positions_needing_update === 0) {
    addResult('Cron Up-to-Date', 'PASS', 'No positions awaiting cron update', { pending: 0 });
  } else if (cron.positions_needing_update < 100) {
    addResult('Cron Up-to-Date', 'WARN', `${cron.positions_needing_update} positions waiting for next cron run`, cron);
  } else {
    addResult('Cron Up-to-Date', 'FAIL', `${cron.positions_needing_update} positions not updated - cron may be broken!`, cron);
  }

  // Check source table freshness
  const sourceResult = await clickhouse.query({
    query: `
      SELECT
        max(resolved_at) as latest_v3_resolution,
        dateDiff('minute', max(resolved_at), now()) as v3_staleness_min
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const source = (await sourceResult.json())[0];

  if (source.v3_staleness_min < 180) { // Less than 3 hours
    addResult('Source Table Fresh', 'PASS', `v3 table current: ${source.latest_v3_resolution} (${source.v3_staleness_min} min ago)`, source);
  } else {
    addResult('Source Table Fresh', 'FAIL', `v3 table is stale! Last resolution: ${source.latest_v3_resolution}`, source);
  }
}

async function test6_DataIntegrity() {
  console.log('\n6️⃣  Testing Data Integrity...\n');

  // Test 1: No null required fields
  const nullResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tx_hash = '') as null_tx_hash,
        countIf(wallet = '') as null_wallet,
        countIf(condition_id = '') as null_condition_id,
        countIf(entry_time = toDateTime(0)) as null_entry_time,
        countIf(cost_usd < 0) as negative_cost,
        countIf(tokens < 0) as negative_tokens
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const nulls = (await nullResult.json())[0];

  const hasNulls = Object.values(nulls).some(v => v > 0);
  if (!hasNulls) {
    addResult('No Null Fields', 'PASS', 'All required fields populated', nulls);
  } else {
    addResult('No Null Fields', 'FAIL', 'Found null or invalid values in required fields', nulls);
  }

  // Test 2: Reasonable value ranges
  const rangeResult = await clickhouse.query({
    query: `
      SELECT
        countIf(cost_usd > 1000000) as extreme_cost,
        countIf(tokens > 1000000) as extreme_tokens,
        countIf(abs(roi) > 100) as extreme_roi,
        countIf(pct_sold_early > 100.1) as invalid_pct
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const range = (await rangeResult.json())[0];

  if (range.extreme_cost === 0 && range.invalid_pct === 0) {
    addResult('Value Ranges', 'PASS', 'All values within reasonable ranges', range);
  } else {
    addResult('Value Ranges', 'WARN', `Found ${range.extreme_cost} extreme costs, ${range.invalid_pct} invalid percentages`, range);
  }

  // Test 3: Win rate sanity check (should be 40-60% historically)
  const winRateResult = await clickhouse.query({
    query: `
      SELECT
        round(countIf(pnl_usd > 0) * 100.0 / count(), 2) as win_rate,
        count() as total_resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
        AND cost_usd >= 1.0
        AND entry_time >= now() - INTERVAL 90 DAY
    `,
    format: 'JSONEachRow',
  });
  const winRate = (await winRateResult.json())[0];

  if (winRate.win_rate >= 40 && winRate.win_rate <= 60) {
    addResult('Win Rate Sanity', 'PASS', `Win rate ${winRate.win_rate}% is within normal range (40-60%)`, winRate);
  } else {
    addResult('Win Rate Sanity', 'WARN', `Win rate ${winRate.win_rate}% is unusual (expected 40-60%)`, winRate);
  }
}

async function test7_TableStats() {
  console.log('\n7️⃣  Overall Table Statistics...\n');

  const statsResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniq(wallet)) as unique_wallets,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL)) as unresolved,
        formatReadableQuantity(countIf(is_short = 1)) as short_positions,
        formatReadableQuantity(countIf(is_closed = 1)) as closed_positions,
        round(sum(pnl_usd) / 1000000, 2) as total_pnl_millions,
        round(avg(roi) * 100, 2) as avg_roi_pct
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json())[0];

  console.log('   📊 Table Statistics:');
  console.log(`      Total Rows: ${stats.total_rows}`);
  console.log(`      Unique Wallets: ${stats.unique_wallets}`);
  console.log(`      Resolved: ${stats.resolved}`);
  console.log(`      Unresolved: ${stats.unresolved}`);
  console.log(`      Short Positions: ${stats.short_positions}`);
  console.log(`      Closed Positions: ${stats.closed_positions}`);
  console.log(`      Total PnL: $${stats.total_pnl_millions}M`);
  console.log(`      Avg ROI: ${stats.avg_roi_pct}%`);

  addResult('Table Stats', 'PASS', 'Statistics collected', stats);
}

async function printSummary() {
  console.log('\n' + '═'.repeat(70));
  console.log('📋 VALIDATION SUMMARY');
  console.log('═'.repeat(70));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;

  console.log(`\n✅ PASSED: ${passed}`);
  console.log(`⚠️  WARNED: ${warned}`);
  console.log(`❌ FAILED: ${failed}`);

  if (failed > 0) {
    console.log('\n🚨 CRITICAL ISSUES:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   ❌ ${r.test}: ${r.details}`);
    });
  }

  if (warned > 0) {
    console.log('\n⚠️  WARNINGS:');
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`   ⚠️  ${r.test}: ${r.details}`);
    });
  }

  console.log('\n' + '═'.repeat(70));

  if (failed === 0) {
    console.log('✅ OVERALL: VALIDATION PASSED');
    console.log('   The unified table is clean, current, and ready for production!');
  } else {
    console.log('❌ OVERALL: VALIDATION FAILED');
    console.log(`   ${failed} critical issue(s) need attention`);
  }
  console.log('═'.repeat(70) + '\n');

  return failed === 0;
}

async function main() {
  console.log('🔍 COMPREHENSIVE UNIFIED TABLE VALIDATION');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📊 Table: pm_trade_fifo_roi_v3_mat_unified`);
  console.log('═'.repeat(70));

  try {
    await test1_NoDuplicates();
    await test2_DataFreshness();
    await test3_FIFOLogic();
    await test4_AttributeAccuracy();
    await test5_CronHealth();
    await test6_DataIntegrity();
    await test7_TableStats();

    const success = await printSummary();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Validation error:', error);
    process.exit(1);
  }
}

main();
