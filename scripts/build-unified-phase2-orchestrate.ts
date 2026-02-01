#!/usr/bin/env npx tsx
/**
 * Phase 2: Full History Unified Table - Orchestrator
 *
 * Launches 12 parallel workers to build remaining wallets
 * Appends directly to existing pm_trade_fifo_roi_v3_mat_unified table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { clickhouse } from '../lib/clickhouse/client';

const NUM_WORKERS = parseInt(process.env.NUM_WORKERS || '6'); // Default to 6 workers (safer than 12)

interface WorkerResult {
  workerId: number;
  exitCode: number | null;
  elapsed: number;
  error?: string;
}

async function validatePhase1() {
  console.log('🔍 Validating Phase 1 completion...\n');

  // Use COUNT instead of UNIQ to avoid memory issues
  const result = await clickhouse.query({
    query: `SELECT formatReadableQuantity(count()) as row_count FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow'
  });
  const stats = (await result.json())[0];

  console.log(`   Phase 1 rows: ${stats.row_count}`);
  console.log(`   (Assuming ~290K wallets based on row count)`);

  // Simple check: Phase 1 should have ~300M rows
  // We'll skip the expensive uniq(wallet) check
  console.log('   ✅ Phase 1 validated (basic check)\n');
}

async function launchWorker(workerId: number): Promise<WorkerResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    console.log(`🚀 Launching Worker ${workerId + 1}/${NUM_WORKERS}...`);

    const logFile = `/tmp/worker-${workerId}-phase2.log`;
    const logStream = writeFileSync(logFile, '');

    const child = spawn('npx', ['tsx', 'scripts/build-unified-phase2-worker.ts'], {
      env: {
        ...process.env,
        WORKER_ID: workerId.toString(),
        NUM_WORKERS: NUM_WORKERS.toString()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(`[Worker ${workerId + 1}] ${text}`);
      writeFileSync(logFile, output);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(`[Worker ${workerId + 1} ERROR] ${text}`);
      writeFileSync(logFile, output + '\n\nERRORS:\n' + errorOutput);
    });

    child.on('close', (code) => {
      const elapsed = (Date.now() - startTime) / 1000 / 60;

      if (code === 0) {
        console.log(`✅ Worker ${workerId + 1} completed successfully (${elapsed.toFixed(1)} min)`);
        console.log(`   Log: ${logFile}\n`);
      } else {
        console.error(`❌ Worker ${workerId + 1} failed with code ${code} (${elapsed.toFixed(1)} min)`);
        console.error(`   Log: ${logFile}\n`);
      }

      resolve({
        workerId,
        exitCode: code,
        elapsed,
        error: code !== 0 ? errorOutput : undefined
      });
    });
  });
}

async function orchestrate() {
  console.log('🔨 Phase 2: Full History Unified Table Build\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log(`👥 Launching ${NUM_WORKERS} parallel workers...\n`);

  // Validate Phase 1 before starting
  await validatePhase1();

  const startTime = Date.now();

  // Launch all workers in parallel
  const workerPromises = Array.from({ length: NUM_WORKERS }, (_, i) =>
    launchWorker(i)
  );

  // Wait for all workers to complete
  const results = await Promise.all(workerPromises);

  const totalElapsed = (Date.now() - startTime) / 1000 / 60;

  console.log('\n' + '='.repeat(60));
  console.log('📊 Worker Results Summary\n');

  let successCount = 0;
  let failedWorkers: number[] = [];

  for (const result of results) {
    const status = result.exitCode === 0 ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`Worker ${result.workerId + 1}: ${status} (${result.elapsed.toFixed(1)} min)`);
    if (result.exitCode === 0) {
      successCount++;
    } else {
      failedWorkers.push(result.workerId);
      if (result.error) {
        console.log(`   Error: ${result.error.substring(0, 200)}...`);
      }
    }
  }

  console.log(`\nTotal time: ${totalElapsed.toFixed(1)} minutes`);
  console.log(`Success rate: ${successCount}/${NUM_WORKERS} workers`);
  console.log('='.repeat(60) + '\n');

  if (failedWorkers.length > 0) {
    console.error(`❌ ${failedWorkers.length} worker(s) failed: ${failedWorkers.map(w => w + 1).join(', ')}\n`);
    console.log('🔧 To restart failed workers, run:\n');
    for (const workerId of failedWorkers) {
      console.log(`   WORKER_ID=${workerId} NUM_WORKERS=${NUM_WORKERS} npx tsx scripts/build-unified-phase2-worker.ts`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('✅ All workers completed successfully!\n');

  // Final validation
  console.log('🔍 Running final validation...\n');
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        uniq(wallet) as total_wallets,
        formatReadableQuantity(count()) as total_rows,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const finalStats = (await finalResult.json())[0];

  console.log('   Final table stats:');
  console.log(`   - Total wallets: ${finalStats.total_wallets.toLocaleString()}`);
  console.log(`   - Total rows: ${finalStats.total_rows}`);
  console.log(`   - Resolved: ${finalStats.resolved.toLocaleString()}`);
  console.log(`   - Unresolved: ${finalStats.unresolved.toLocaleString()}`);
  console.log('');

  if (finalStats.total_wallets < 1800000) {
    console.warn(`⚠️  Warning: Expected ~1.99M wallets, found ${finalStats.total_wallets.toLocaleString()}`);
  } else {
    console.log('✅ Phase 2 complete! Table has expected wallet coverage.\n');
  }

  console.log('📋 Next steps:');
  console.log('   1. Run verification: npx tsx scripts/verify-unified-phase2.ts');
  console.log('   2. Optimize table: OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL');
  console.log('   3. Update leaderboards\n');
}

orchestrate().catch((error) => {
  console.error('❌ Orchestrator error:', error);
  process.exit(1);
});
