#!/usr/bin/env npx tsx
/**
 * Phase 2 Orchestrator with Automatic Fallback
 *
 * Tries 12 workers first, falls back to 6, then 3 if timeouts occur
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { clickhouse } from '../lib/clickhouse/client';

async function checkPhase1() {
  const result = await clickhouse.query({
    query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow'
  });
  const stats = (await result.json())[0];
  return stats.wallets;
}

async function runWithWorkerCount(numWorkers: number): Promise<boolean> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔨 Attempting Phase 2 with ${numWorkers} workers`);
  console.log('='.repeat(60) + '\n');

  const logFile = `phase2-build-${numWorkers}workers.log`;

  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'scripts/build-unified-phase2-orchestrate.ts'], {
      env: {
        ...process.env,
        NUM_WORKERS_OVERRIDE: numWorkers.toString()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
      writeFileSync(logFile, output);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(text);
      writeFileSync(logFile, output + '\n\nERRORS:\n' + errorOutput);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${numWorkers} workers completed successfully!`);
        resolve(true);
      } else {
        console.error(`\n❌ ${numWorkers} workers failed (exit code ${code})`);

        // Check if failure was due to timeout
        const hasTimeout = errorOutput.includes('timeout') || errorOutput.includes('timed out');
        if (hasTimeout) {
          console.log(`⚠️  Detected timeout errors with ${numWorkers} workers`);
        }

        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('🔨 Phase 2: Full History Build with Automatic Fallback\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  // Validate Phase 1
  console.log('🔍 Validating Phase 1...');
  const phase1Wallets = await checkPhase1();
  console.log(`   Phase 1 wallets: ${phase1Wallets.toLocaleString()}`);

  if (phase1Wallets < 280000 || phase1Wallets > 300000) {
    throw new Error(`Phase 1 validation failed: Expected ~290K wallets, found ${phase1Wallets.toLocaleString()}`);
  }
  console.log('   ✅ Phase 1 validated\n');

  // Try different worker counts with fallback
  const workerCounts = [12, 6, 3];

  for (const numWorkers of workerCounts) {
    const success = await runWithWorkerCount(numWorkers);

    if (success) {
      console.log('\n' + '='.repeat(60));
      console.log('✅ Phase 2 Complete!');
      console.log('='.repeat(60) + '\n');

      // Final stats
      const result = await clickhouse.query({
        query: `
          SELECT
            uniq(wallet) as total_wallets,
            formatReadableQuantity(count()) as total_rows
          FROM pm_trade_fifo_roi_v3_mat_unified
        `,
        format: 'JSONEachRow'
      });
      const stats = (await result.json())[0];

      console.log('📊 Final Statistics:');
      console.log(`   Total wallets: ${stats.total_wallets.toLocaleString()}`);
      console.log(`   Total rows: ${stats.total_rows}`);
      console.log('');
      console.log('📋 Next steps:');
      console.log('   1. Run verification: npx tsx scripts/verify-unified-phase2.ts');
      console.log('   2. Optimize table: OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL');
      console.log('');

      return;
    }

    // Failed - try next worker count
    if (numWorkers > 3) {
      console.log(`\n⚠️  ${numWorkers} workers failed. Trying with ${numWorkers / 2} workers...\n`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    } else {
      console.error('\n❌ All worker counts failed. Manual intervention required.\n');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
