/**
 * ============================================================================
 * Test Wallet Confidence Scoring
 * ============================================================================
 *
 * Tests the getWalletConfidence helper against benchmark wallets to validate
 * that confidence scores correlate with V20 accuracy.
 *
 * Usage:
 *   npx tsx scripts/pnl/test-wallet-confidence.ts
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { getWalletConfidence, WalletConfidence } from '../../lib/pnl/getWalletConfidence';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
}

async function getBenchmarks(): Promise<BenchmarkRow[]> {
  const result = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = 'fresh_2025_12_04_alltime'
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as BenchmarkRow[];
}

function calculateError(actual: number, expected: number): number {
  if (expected === 0 && actual === 0) return 0;
  if (expected === 0) return 100;
  return Math.abs((actual - expected) / expected) * 100;
}

function formatPnl(pnl: number): string {
  const sign = pnl < 0 ? '-' : '+';
  const abs = Math.abs(pnl);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('WALLET CONFIDENCE SCORING TEST');
  console.log('='.repeat(80));
  console.log('');

  const benchmarks = await getBenchmarks();
  console.log(`Testing ${benchmarks.length} wallets...`);
  console.log('');

  interface Result {
    wallet: string;
    uiPnl: number;
    v20Pnl: number;
    errorPct: number;
    passed: boolean;
    confidence: WalletConfidence;
  }

  const results: Result[] = [];

  for (const bench of benchmarks) {
    try {
      const v20 = await calculateV20PnL(bench.wallet);
      const confidence = await getWalletConfidence(bench.wallet);
      const errorPct = calculateError(v20.total_pnl, bench.pnl_value);

      results.push({
        wallet: bench.wallet,
        uiPnl: bench.pnl_value,
        v20Pnl: v20.total_pnl,
        errorPct,
        passed: errorPct < 5,
        confidence,
      });

      process.stdout.write(`\rProcessed ${results.length}/${benchmarks.length}...`);
    } catch (e) {
      console.error(`\nError processing ${bench.wallet}:`, e);
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Group by confidence level
  const byLevel: Record<string, Result[]> = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const r of results) {
    byLevel[r.confidence.confidence_level].push(r);
  }

  console.log('='.repeat(80));
  console.log('RESULTS BY CONFIDENCE LEVEL');
  console.log('='.repeat(80));
  console.log('');

  for (const level of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    const group = byLevel[level];
    const passCount = group.filter((r) => r.passed).length;
    const passRate = group.length > 0 ? (passCount / group.length) * 100 : 0;
    const avgError = group.length > 0 ? group.reduce((sum, r) => sum + r.errorPct, 0) / group.length : 0;

    console.log(`${level} Confidence (${group.length} wallets):`);
    console.log(`  Pass rate: ${passRate.toFixed(1)}% (${passCount}/${group.length})`);
    console.log(`  Avg error: ${avgError.toFixed(1)}%`);
    console.log('');
  }

  // Show correlation between confidence score and error
  console.log('='.repeat(80));
  console.log('CONFIDENCE vs ERROR CORRELATION');
  console.log('='.repeat(80));
  console.log('');
  console.log('wallet'.padEnd(14), 'conf'.padStart(6), 'level'.padStart(8), 'error'.padStart(8), 'pass'.padStart(6), 'warnings');
  console.log('-'.repeat(100));

  // Sort by confidence score descending
  results.sort((a, b) => b.confidence.confidence_score - a.confidence.confidence_score);

  for (const r of results) {
    const walletShort = r.wallet.slice(0, 12) + '..';
    const confStr = (r.confidence.confidence_score * 100).toFixed(0) + '%';
    const errStr = r.errorPct.toFixed(1) + '%';
    const passStr = r.passed ? 'PASS' : 'FAIL';
    const warnings = r.confidence.warnings.slice(0, 2).join(', ') || '-';

    console.log(
      walletShort.padEnd(14),
      confStr.padStart(6),
      r.confidence.confidence_level.padStart(8),
      errStr.padStart(8),
      passStr.padStart(6),
      warnings
    );
  }
  console.log('');

  // Summary statistics
  console.log('='.repeat(80));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(80));

  const highPassRate = byLevel.HIGH.length > 0 ? (byLevel.HIGH.filter((r) => r.passed).length / byLevel.HIGH.length) * 100 : 0;
  const lowPassRate = byLevel.LOW.length > 0 ? (byLevel.LOW.filter((r) => r.passed).length / byLevel.LOW.length) * 100 : 0;

  console.log(`
1. HIGH Confidence wallets: ${highPassRate.toFixed(0)}% pass rate
   - These are "clean" CLOB-only wallets where V20 excels

2. LOW Confidence wallets: ${lowPassRate.toFixed(0)}% pass rate
   - These have significant non-CLOB activity

3. RECOMMENDATION:
   - Return V20 PnL with confidence_level in API response
   - HIGH confidence: Display normally
   - MEDIUM/LOW: Show with "estimated" qualifier
`);
}

main().catch(console.error);
