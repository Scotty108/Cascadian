#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * FAST CONCURRENT VALIDATION
 * ============================================================================
 *
 * Validates engines against Dome with:
 * - Concurrent wallet processing (3 at a time)
 * - Streaming results output
 * - Real-time pass/fail reporting
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-fast-concurrent.ts
 *   npx tsx scripts/pnl/validate-fast-concurrent.ts --input=tmp/clob_10_wallets.json --concurrency=5
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getEngineRegistry, EngineName, PnLResult } from '../../lib/pnl/engines/engineRegistry';
import { isPassDome, DOME_THRESHOLDS } from '../../lib/pnl/validationThresholds';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let input = 'tmp/clob_10_wallets.json';
let output = 'tmp/fast_validation_results.json';
let concurrency = 3;

for (const arg of args) {
  if (arg.startsWith('--input=')) input = arg.split('=')[1];
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
  if (arg.startsWith('--concurrency=')) concurrency = parseInt(arg.split('=')[1]);
}

// ============================================================================
// Types
// ============================================================================

interface WalletResult {
  wallet: string;
  dome_realized: number;
  engines: {
    V11: { pnl: number; pass: boolean; error: number; time: number };
    V29: { pnl: number; pass: boolean; error: number; time: number };
    V23C: { pnl: number; pass: boolean; error: number; time: number };
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('FAST CONCURRENT VALIDATION');
  console.log('='.repeat(80));
  console.log(`\nInput: ${input}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Thresholds: ${DOME_THRESHOLDS.pctThreshold}% (large) / $${DOME_THRESHOLDS.absThreshold} (small)\n`);

  // Load input
  if (!fs.existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets;

  console.log(`Loaded ${wallets.length} wallets\n`);
  console.log('='.repeat(80));
  console.log('STREAMING RESULTS');
  console.log('='.repeat(80));
  console.log('\nWallet            | Dome      | V11       | V29       | V23C      |');
  console.log('-'.repeat(72));

  const registry = getEngineRegistry();
  const results: WalletResult[] = [];

  // Track stats
  const stats = {
    V11: { pass: 0, fail: 0, totalTime: 0 },
    V29: { pass: 0, fail: 0, totalTime: 0 },
    V23C: { pass: 0, fail: 0, totalTime: 0 },
  };

  // Process in batches
  for (let i = 0; i < wallets.length; i += concurrency) {
    const batch = wallets.slice(i, i + concurrency);

    // Process batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (w: any) => {
        const walletAddr = w.wallet_address;
        const domeRealized = w.dome_realized;

        const engineResults = await registry.computeAllEngines(walletAddr);

        const result: WalletResult = {
          wallet: walletAddr,
          dome_realized: domeRealized,
          engines: {
            V11: { pnl: 0, pass: false, error: 100, time: 0 },
            V29: { pnl: 0, pass: false, error: 100, time: 0 },
            V23C: { pnl: 0, pass: false, error: 100, time: 0 },
          },
        };

        for (const engineName of ['V11', 'V29', 'V23C'] as EngineName[]) {
          const er = engineResults.get(engineName);
          if (er) {
            const passResult = isPassDome(domeRealized, er.realizedPnl);
            result.engines[engineName] = {
              pnl: er.realizedPnl,
              pass: passResult.passed,
              error: passResult.pctError,
              time: er.computeTimeMs,
            };
          }
        }

        return result;
      })
    );

    // Print streaming results
    for (const r of batchResults) {
      results.push(r);

      // Update stats
      for (const engineName of ['V11', 'V29', 'V23C'] as EngineName[]) {
        const e = r.engines[engineName];
        if (e.pass) {
          stats[engineName].pass++;
        } else {
          stats[engineName].fail++;
        }
        stats[engineName].totalTime += e.time;
      }

      // Format output
      const shortWallet = r.wallet.slice(0, 10) + '...';
      const dome = `$${r.dome_realized.toFixed(0)}`.padStart(9);

      const v11Status = r.engines.V11.pass ? '✓' : '✗';
      const v29Status = r.engines.V29.pass ? '✓' : '✗';
      const v23cStatus = r.engines.V23C.pass ? '✓' : '✗';

      const v11 = `${v11Status}$${r.engines.V11.pnl.toFixed(0)}`.padStart(9);
      const v29 = `${v29Status}$${r.engines.V29.pnl.toFixed(0)}`.padStart(9);
      const v23c = `${v23cStatus}$${r.engines.V23C.pnl.toFixed(0)}`.padStart(9);

      console.log(`${shortWallet}  | ${dome} | ${v11} | ${v29} | ${v23c} |`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const total = wallets.length;

  console.log('\nPass rates:');
  for (const engineName of ['V11', 'V29', 'V23C'] as EngineName[]) {
    const s = stats[engineName];
    const passRate = ((s.pass / total) * 100).toFixed(1);
    const avgTime = (s.totalTime / total).toFixed(0);
    console.log(`  ${engineName}: ${passRate}% (${s.pass}/${total}) - avg ${avgTime}ms`);
  }

  // Save results
  const outputData = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      concurrency,
      total_wallets: total,
    },
    summary: {
      V11: { passRate: stats.V11.pass / total, avgTimeMs: stats.V11.totalTime / total },
      V29: { passRate: stats.V29.pass / total, avgTimeMs: stats.V29.totalTime / total },
      V23C: { passRate: stats.V23C.pass / total, avgTimeMs: stats.V23C.totalTime / total },
    },
    results,
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nOutput: ${output}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
