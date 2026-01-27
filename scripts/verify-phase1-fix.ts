/**
 * Phase 1 Verification Script
 *
 * Checks if the canonical fills fix is working in production by:
 * 1. Finding the most recent cron execution
 * 2. Checking fills from the overlap window (last 3000 blocks)
 * 3. Reporting empty condition_id percentage
 *
 * Expected result: pct_empty < 0.1% (ideally 0%)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function verifyFix() {
  console.log('=== PHASE 1 FIX VERIFICATION ===');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // 1. Check most recent cron execution
  const cronResult = await clickhouse.query({
    query: `
      SELECT
        executed_at,
        status,
        duration_ms,
        details
      FROM cron_executions
      WHERE cron_name = 'update-canonical-fills'
      ORDER BY executed_at DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const cronRows = await cronResult.json() as any[];
  const lastCron = cronRows[0];

  console.log('Last cron execution:');
  console.log(`  Time: ${lastCron.executed_at}`);
  console.log(`  Status: ${lastCron.status}`);
  console.log(`  Duration: ${lastCron.duration_ms}ms`);
  console.log(`  Details: ${lastCron.details}\n`);

  // 2. Get current watermark
  const watermarkResult = await clickhouse.query({
    query: `SELECT last_block_number FROM pm_ingest_watermarks_v1 FINAL WHERE source = 'clob'`,
    format: 'JSONEachRow'
  });
  const watermarkRows = await watermarkResult.json() as any[];
  const currentBlock = watermarkRows[0].last_block_number;
  const startBlock = currentBlock - 3000; // Overlap window

  console.log(`Block range:`);
  console.log(`  Current watermark: ${currentBlock}`);
  console.log(`  Overlap start: ${startBlock}\n`);

  // 3. Check fills in overlap window
  const fillsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(condition_id = '') as empty,
        round(countIf(condition_id = '') * 100.0 / count(), 4) as pct_empty
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND block_number > ${startBlock}
    `,
    format: 'JSONEachRow'
  });
  const fillsRows = await fillsResult.json() as any[];
  const stats = fillsRows[0];

  console.log('Overlap window fills:');
  console.log(`  Total: ${stats.total.toLocaleString()}`);
  console.log(`  Empty condition_ids: ${stats.empty.toLocaleString()}`);
  console.log(`  Empty percentage: ${stats.pct_empty}%\n`);

  // 4. Verdict
  const threshold = 0.1;
  const passed = stats.pct_empty <= threshold;

  console.log('=== VERDICT ===');
  if (passed) {
    console.log(`✅ PASS: ${stats.pct_empty}% empty (threshold: ${threshold}%)`);
    console.log('The fix is working! New fills have no empty condition_ids.');
  } else {
    console.log(`❌ FAIL: ${stats.pct_empty}% empty (threshold: ${threshold}%)`);
    console.log('The fix is NOT working yet. Possible reasons:');
    console.log('  1. Vercel deployment still in progress');
    console.log('  2. Cron running old code from cache');
    console.log('  3. Next cron run needed to pick up new code');
    console.log('\nWait for next cron run (~10 min intervals) and run this script again.');
  }

  return passed;
}

verifyFix()
  .then(passed => process.exit(passed ? 0 : 1))
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
