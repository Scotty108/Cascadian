#!/usr/bin/env npx tsx
/**
 * Phase 2 Watchdog
 *
 * Monitors the running Phase 2 build and automatically retries with fewer workers if failures detected
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { existsSync, readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { clickhouse } from '../lib/clickhouse/client';

const execAsync = promisify(exec);

interface WorkerStatus {
  workerId: number;
  isRunning: boolean;
  hasFailed: boolean;
  hasTimeout: boolean;
  lastWalletCount: number;
}

async function checkWorkerLogs(): Promise<WorkerStatus[]> {
  const statuses: WorkerStatus[] = [];

  for (let i = 0; i < 12; i++) {
    const logFile = `/tmp/worker-${i}-phase2.log`;
    const status: WorkerStatus = {
      workerId: i,
      isRunning: false,
      hasFailed: false,
      hasTimeout: false,
      lastWalletCount: 0
    };

    if (existsSync(logFile)) {
      const content = readFileSync(logFile, 'utf8');

      // Check if worker completed
      status.isRunning = !content.includes('Worker') || !content.includes('complete');

      // Check for errors
      status.hasFailed = content.includes('ERROR') || content.includes('failed');
      status.hasTimeout = content.includes('timeout') || content.includes('timed out');

      // Extract wallet count if available
      const walletMatch = content.match(/Found (\d+(?:,\d+)*) NEW wallets/);
      if (walletMatch) {
        status.lastWalletCount = parseInt(walletMatch[1].replace(/,/g, ''));
      }
    }

    statuses.push(status);
  }

  return statuses;
}

async function getCurrentProgress() {
  try {
    const result = await clickhouse.query({
      query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unified`,
      format: 'JSONEachRow'
    });
    const stats = (await result.json())[0];
    return stats.wallets;
  } catch (error) {
    return 0;
  }
}

async function killCurrentRun() {
  console.log('🛑 Killing current worker processes...');
  try {
    // Kill all npx tsx processes running the worker script
    await execAsync('pkill -f "build-unified-phase2-worker"');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for cleanup
    console.log('   ✅ Processes killed\n');
  } catch (error) {
    // Ignore errors if no processes found
    console.log('   ✅ No processes to kill\n');
  }
}

async function startFallback(numWorkers: number) {
  console.log(`🔄 Starting fallback with ${numWorkers} workers...\n`);

  const { spawn } = await import('child_process');
  const child = spawn('npx', ['tsx', 'scripts/build-unified-phase2-orchestrate.ts'], {
    env: {
      ...process.env,
      NUM_WORKERS: numWorkers.toString()
    },
    stdio: 'inherit',
    detached: true
  });

  child.unref(); // Allow parent to exit while child continues
  console.log(`   ✅ Fallback started with PID ${child.pid}\n`);
}

async function watchdog() {
  console.log('🐕 Phase 2 Watchdog Started\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('Monitoring for failures and timeouts...\n');

  const startWallets = await getCurrentProgress();
  let lastProgress = startWallets;
  let noProgressCount = 0;
  let checkCount = 0;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 300000)); // Check every 5 minutes
    checkCount++;

    console.log(`\n📊 Watchdog Check #${checkCount} (${new Date().toLocaleString()})`);

    // Check worker logs
    const statuses = await checkWorkerLogs();
    const failedCount = statuses.filter(s => s.hasFailed || s.hasTimeout).length;
    const runningCount = statuses.filter(s => s.isRunning).length;

    console.log(`   Running workers: ${runningCount}/12`);
    console.log(`   Failed workers: ${failedCount}/12`);

    // Check progress
    const currentWallets = await getCurrentProgress();
    const walletDelta = currentWallets - lastProgress;
    console.log(`   Wallet count: ${currentWallets.toLocaleString()} (+${walletDelta.toLocaleString()})`);

    // Decision logic
    if (failedCount >= 6) {
      // More than half failed - switch to 6 workers
      console.log('\n⚠️  MORE THAN HALF OF WORKERS FAILED\n');
      await killCurrentRun();
      await startFallback(6);
      console.log('✅ Switched to 6-worker fallback. Watchdog exiting.\n');
      break;
    } else if (failedCount >= 4 && checkCount > 4) {
      // 1/3 failed after 20 minutes - switch to 6 workers
      console.log('\n⚠️  SIGNIFICANT WORKER FAILURES DETECTED\n');
      await killCurrentRun();
      await startFallback(6);
      console.log('✅ Switched to 6-worker fallback. Watchdog exiting.\n');
      break;
    } else if (walletDelta === 0 && checkCount > 6) {
      // No progress for 30 minutes - likely all stuck
      noProgressCount++;
      console.log(`   ⚠️  No progress (${noProgressCount}/3)`);

      if (noProgressCount >= 3) {
        console.log('\n⚠️  NO PROGRESS FOR 45 MINUTES - WORKERS STUCK\n');
        await killCurrentRun();
        await startFallback(3);
        console.log('✅ Switched to 3-worker fallback. Watchdog exiting.\n');
        break;
      }
    } else {
      noProgressCount = 0; // Reset no-progress counter
    }

    // Check if complete
    if (currentWallets >= 1900000) {
      console.log('\n✅ Phase 2 appears complete! Watchdog exiting.\n');
      break;
    }

    lastProgress = currentWallets;
  }
}

watchdog().catch((error) => {
  console.error('❌ Watchdog error:', error);
  process.exit(1);
});
