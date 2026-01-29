#!/usr/bin/env npx tsx
/**
 * Phase 1: 10-Day Unified Table - Orchestrator
 *
 * Launches 3 parallel workers to build unresolved positions
 * Then merges with existing data to create production table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const NUM_WORKERS = 3;

interface WorkerResult {
  workerId: number;
  exitCode: number | null;
  elapsed: number;
  error?: string;
}

async function launchWorker(workerId: number): Promise<WorkerResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    console.log(`🚀 Launching Worker ${workerId + 1}/${NUM_WORKERS}...`);

    const logFile = `/tmp/worker-${workerId}-10day.log`;
    const logStream = writeFileSync(logFile, '');

    const child = spawn('npx', ['tsx', 'scripts/build-unified-10day-worker.ts'], {
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
  console.log('🔨 Phase 1: 10-Day Unified Table Build\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log(`👥 Launching ${NUM_WORKERS} parallel workers...\n`);

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

  let allSucceeded = true;
  for (const result of results) {
    const status = result.exitCode === 0 ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`Worker ${result.workerId + 1}: ${status} (${result.elapsed.toFixed(1)} min)`);
    if (result.exitCode !== 0) {
      allSucceeded = false;
      if (result.error) {
        console.log(`   Error: ${result.error.substring(0, 200)}...`);
      }
    }
  }

  console.log(`\nTotal time: ${totalElapsed.toFixed(1)} minutes`);
  console.log('='.repeat(60) + '\n');

  if (!allSucceeded) {
    console.error('❌ Some workers failed. Fix errors and retry failed workers.\n');
    process.exit(1);
  }

  console.log('✅ All workers completed successfully!\n');
  console.log('📋 Next step: Run merge script to create production table');
  console.log('   npx tsx scripts/merge-10day-to-production.ts\n');
}

orchestrate().catch((error) => {
  console.error('❌ Orchestrator error:', error);
  process.exit(1);
});
