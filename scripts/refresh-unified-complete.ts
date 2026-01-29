#!/usr/bin/env npx tsx
/**
 * Complete Unified Table Refresh
 *
 * 1. Refreshes unresolved positions (3 parallel workers)
 * 2. Refreshes resolved positions
 * 3. Shows final stats
 */
import { spawn, execSync } from 'child_process';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const NUM_WORKERS = 3;

async function getStats(label: string) {
  const result = await clickhouse.query({
    query: `
      SELECT
        max(CASE WHEN resolved_at IS NOT NULL THEN resolved_at END) as newest_resolution,
        date_diff('minute', max(CASE WHEN resolved_at IS NOT NULL THEN resolved_at END), now()) as minutes_stale_resolved,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as minutes_stale_unresolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const stats = (await result.json())[0];

  console.log(`\n📊 ${label}:`);
  console.log(`   Resolved: ${stats.newest_resolution} (${stats.minutes_stale_resolved} min stale)`);
  console.log(`   Unresolved: ${stats.newest_unresolved} (${stats.minutes_stale_unresolved} min stale)\n`);

  return stats;
}

async function runUnresolvedRefresh() {
  console.log('🔄 STEP 1: Refreshing Unresolved Positions (3 parallel workers)\n');
  console.log('═'.repeat(70));
  console.log('');

  const startTime = Date.now();

  // Launch 3 workers
  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => {
    const logFile = `/tmp/refresh-worker-${i}.log`;
    console.log(`Worker ${i}: Logging to ${logFile}`);

    const worker = spawn('npx', ['tsx', 'scripts/refresh-incremental-worker.ts'], {
      env: { ...process.env, WORKER_ID: i.toString(), NUM_WORKERS: NUM_WORKERS.toString() },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    const fs = require('fs');
    const logStream = fs.createWriteStream(logFile);
    worker.stdout.pipe(logStream);
    worker.stderr.pipe(logStream);

    return new Promise<{ workerId: number; success: boolean; error?: string }>((resolve) => {
      worker.on('close', (code) => {
        resolve({ workerId: i, success: code === 0, error: code !== 0 ? `Exit code ${code}` : undefined });
      });
      worker.on('error', (err) => {
        resolve({ workerId: i, success: false, error: err.message });
      });
    });
  });

  console.log('\nWorkers launched! Waiting for completion...\n');

  const results = await Promise.all(workers);
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('═'.repeat(70));
  console.log('\n📊 Unresolved Worker Results:\n');

  let allSuccess = true;
  for (const result of results) {
    console.log(result.success ? `✅ Worker ${result.workerId}: SUCCESS` : `❌ Worker ${result.workerId}: FAILED - ${result.error}`);
    allSuccess = allSuccess && result.success;
  }

  console.log(`\nUnresolved refresh time: ${elapsed} minutes\n`);

  if (!allSuccess) {
    throw new Error('Some unresolved workers failed');
  }

  return elapsed;
}

async function runResolvedRefresh() {
  console.log('\n🔄 STEP 2: Refreshing Resolved Positions\n');
  console.log('═'.repeat(70));
  console.log('');

  const startTime = Date.now();

  // Run resolved refresh synchronously
  try {
    execSync('npx tsx scripts/refresh-resolved-30h.ts', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\nResolved refresh time: ${elapsed} minutes\n`);
    return elapsed;
  } catch (err) {
    throw new Error(`Resolved refresh failed: ${err.message}`);
  }
}

async function main() {
  console.log('\n🚀 COMPLETE UNIFIED TABLE REFRESH\n');
  console.log('This will refresh both unresolved and resolved positions\n');

  const overallStart = Date.now();

  // Get before stats
  await getStats('BEFORE Refresh');

  try {
    // Step 1: Unresolved (parallel)
    const unresolvedTime = await runUnresolvedRefresh();

    // Step 2: Resolved (sequential)
    const resolvedTime = await runResolvedRefresh();

    // Get after stats
    await getStats('AFTER Refresh');

    const totalTime = ((Date.now() - overallStart) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('\n✅ REFRESH COMPLETE!\n');
    console.log(`   Unresolved: ${unresolvedTime} min`);
    console.log(`   Resolved: ${resolvedTime} min`);
    console.log(`   Total: ${totalTime} min\n`);
    console.log('Table is now fully fresh!\n');

  } catch (err) {
    console.error(`\n❌ Refresh failed: ${err.message}\n`);
    process.exit(1);
  }
}

main();
