#!/usr/bin/env npx tsx
/**
 * Incremental Refresh Orchestrator
 *
 * Launches 3 parallel workers to refresh unresolved positions
 * Also refreshes resolved positions
 */
import { spawn } from 'child_process';
import { config } from 'dotenv';
config({ path: '.env.local' });

const NUM_WORKERS = 3;

async function orchestrate() {
  console.log('🚀 Incremental Refresh Orchestrator\n');
  console.log(`Starting ${NUM_WORKERS} parallel workers...\n`);
  console.log('═'.repeat(70));
  console.log('');

  const startTime = Date.now();

  // Launch 3 workers in parallel
  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => {
    const logFile = `/tmp/refresh-worker-${i}.log`;
    console.log(`Worker ${i}: Logging to ${logFile}`);

    const worker = spawn('npx', ['tsx', 'scripts/refresh-incremental-worker.ts'], {
      env: { ...process.env, WORKER_ID: i.toString(), NUM_WORKERS: NUM_WORKERS.toString() },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    // Stream output to log file
    const fs = require('fs');
    const logStream = fs.createWriteStream(logFile);
    worker.stdout.pipe(logStream);
    worker.stderr.pipe(logStream);

    return new Promise<{ workerId: number; success: boolean; error?: string }>((resolve) => {
      worker.on('close', (code) => {
        if (code === 0) {
          resolve({ workerId: i, success: true });
        } else {
          resolve({ workerId: i, success: false, error: `Exit code ${code}` });
        }
      });

      worker.on('error', (err) => {
        resolve({ workerId: i, success: false, error: err.message });
      });
    });
  });

  console.log('');
  console.log('Workers launched! Monitor progress:');
  for (let i = 0; i < NUM_WORKERS; i++) {
    console.log(`  tail -f /tmp/refresh-worker-${i}.log`);
  }
  console.log('');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Waiting for all workers to complete...\n');

  // Wait for all workers
  const results = await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('═'.repeat(70));
  console.log('\n📊 Worker Results:\n');

  let allSuccess = true;
  for (const result of results) {
    if (result.success) {
      console.log(`✅ Worker ${result.workerId}: SUCCESS`);
    } else {
      console.log(`❌ Worker ${result.workerId}: FAILED - ${result.error}`);
      allSuccess = false;
    }
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log(`\nTotal time: ${elapsed} minutes\n`);

  if (allSuccess) {
    console.log('✅ All workers completed successfully!\n');
    console.log('Next step: Run resolved refresh for newly resolved conditions\n');
    console.log('  npx tsx scripts/refresh-resolved-30h.ts\n');
  } else {
    console.log('⚠️  Some workers failed. Check logs above.\n');
    console.log('To restart failed workers:');
    for (const result of results) {
      if (!result.success) {
        console.log(`  WORKER_ID=${result.workerId} NUM_WORKERS=${NUM_WORKERS} npx tsx scripts/refresh-incremental-worker.ts\n`);
      }
    }
  }
}

orchestrate().catch(console.error);
