#!/usr/bin/env npx tsx
/**
 * Validate V29 engine on expanded TRADER_STRICT sample v2 - OPTIMIZED
 *
 * OPTIMIZATIONS:
 * - Batch cash flow query (single SQL for all wallets)
 * - Concurrency limiter for V29 engine calls
 * - JSONL checkpointing (resume from partial runs)
 * - Per-wallet timing instrumentation
 * - CLI flags: --limit, --concurrency
 */

import { calculateV29PnL, V29Preload } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data, V29PreloadData } from '../../lib/pnl/v29BatchLoaders';
import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';
import path from 'path';

interface WalletCandidate {
  wallet_address: string;
  clob_count: number;
  redemption_count: number;
  split_count: number;
  merge_count: number;
  distinct_conditions: number;
  total_usdc_flow: number;
  is_trader_strict: boolean;
}

interface ValidationResult {
  wallet: string;
  v29_realized: number;
  v29_resolved_unredeemed: number;
  v29_unrealized: number;
  v29_ui_parity: number;
  v29_ui_parity_clamped: number;
  simple_cash_pnl: number;
  realized_vs_cash_pct_error: number;
  clob_count: number;
  redemption_count: number;
  distinct_conditions: number;
  duration_ms: number;
  status: 'pass' | 'fail' | 'error';
  error_message?: string;
}

// Concurrency limiter
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve as () => void));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

async function batchLoadCashFlow(wallets: string[]): Promise<Map<string, number>> {
  const startTime = Date.now();
  console.log(`\n🔄 Batch loading cash flow for ${wallets.length} wallets...`);

  const walletList = wallets.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      sum(usdc_delta) as cash_flow,
      count() as ledger_rows
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) IN (${walletList})
      AND source_type IN ('CLOB', 'PayoutRedemption')
      AND usdc_delta != 0
    GROUP BY wallet
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  });

  const data = await result.json<any>();
  const cashFlowMap = new Map<string, number>();

  for (const row of data) {
    cashFlowMap.set(row.wallet, Number(row.cash_flow));
  }

  // Ensure all wallets have an entry (even if 0)
  for (const wallet of wallets) {
    if (!cashFlowMap.has(wallet.toLowerCase())) {
      cashFlowMap.set(wallet.toLowerCase(), 0);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`✅ Batch cash flow loaded in ${duration}ms (${data.length} wallets with data)`);

  return cashFlowMap;
}

async function loadCheckpoint(checkpointPath: string): Promise<Set<string>> {
  try {
    const content = await fs.readFile(checkpointPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const completed = new Set<string>();
    for (const line of lines) {
      const result = JSON.parse(line);
      completed.add(result.wallet.toLowerCase());
    }
    return completed;
  } catch (error) {
    return new Set();
  }
}

async function appendCheckpoint(checkpointPath: string, result: ValidationResult) {
  await fs.appendFile(checkpointPath, JSON.stringify(result) + '\n');
}

async function validateWallet(
  candidate: WalletCandidate,
  cashFlowMap: Map<string, number>,
  preloadData: V29PreloadData,
  timeoutMs: number
): Promise<ValidationResult> {
  const wallet = candidate.wallet_address.toLowerCase();
  const startTime = Date.now();

  try {
    // Get preloaded events for this wallet
    const events = preloadData.eventsByWallet.get(wallet) || [];

    // Build preload object
    const preload: V29Preload = {
      events,
      resolutionPrices: preloadData.resolutionPrices
    };

    // Run V29 PnL calculation with timeout and preloaded data
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    });

    const v29Result = await Promise.race([
      calculateV29PnL(wallet, { inventoryGuard: true, preload }),
      timeoutPromise
    ]) as any;

    // Get simple cash from pre-loaded map
    const simpleCash = cashFlowMap.get(wallet.toLowerCase()) || 0;

    // Calculate percentage error
    const denominator = Math.max(1, Math.abs(simpleCash));
    const pctError = ((v29Result.realizedPnl - simpleCash) / denominator) * 100;

    const duration = Date.now() - startTime;

    const result: ValidationResult = {
      wallet,
      v29_realized: v29Result.realizedPnl,
      v29_resolved_unredeemed: v29Result.resolvedUnredeemedValue,
      v29_unrealized: v29Result.unrealizedPnl,
      v29_ui_parity: v29Result.uiParityPnl,
      v29_ui_parity_clamped: v29Result.uiParityClampedPnl,
      simple_cash_pnl: simpleCash,
      realized_vs_cash_pct_error: pctError,
      clob_count: candidate.clob_count,
      redemption_count: candidate.redemption_count,
      distinct_conditions: candidate.distinct_conditions,
      duration_ms: duration,
      status: Math.abs(pctError) < 3 ? 'pass' : 'fail'
    };

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message === 'TIMEOUT';

    return {
      wallet,
      v29_realized: 0,
      v29_resolved_unredeemed: 0,
      v29_unrealized: 0,
      v29_ui_parity: 0,
      v29_ui_parity_clamped: 0,
      simple_cash_pnl: cashFlowMap.get(wallet.toLowerCase()) || 0,
      realized_vs_cash_pct_error: 0,
      clob_count: candidate.clob_count,
      redemption_count: candidate.redemption_count,
      distinct_conditions: candidate.distinct_conditions,
      duration_ms: duration,
      status: 'error',
      error_message: isTimeout
        ? `TIMEOUT (>${timeoutMs}ms) - ledger_rows=${candidate.ledger_rows || 'unknown'}, conditions=${candidate.distinct_conditions}`
        : (error instanceof Error ? error.message : String(error))
    };
  }
}

function computeDistributionStats(results: ValidationResult[]) {
  const validResults = results.filter(r => r.status !== 'error');
  const errors = validResults.map(r => Math.abs(r.realized_vs_cash_pct_error)).sort((a, b) => a - b);

  if (errors.length === 0) {
    return { median: 0, mean: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }

  const median = errors[Math.floor(errors.length / 2)];
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const p90 = errors[Math.floor(errors.length * 0.9)];
  const p95 = errors[Math.floor(errors.length * 0.95)];
  const p99 = errors[Math.floor(errors.length * 0.99)];
  const max = errors[errors.length - 1];

  return { median, mean, p90, p95, p99, max };
}

function printDistribution(results: ValidationResult[]) {
  const validResults = results.filter(r => r.status !== 'error');
  const buckets = [
    { label: '  0.0-0.5%', min: 0, max: 0.5 },
    { label: '  0.5-1.0%', min: 0.5, max: 1.0 },
    { label: '  1.0-2.0%', min: 1.0, max: 2.0 },
    { label: '  2.0-3.0%', min: 2.0, max: 3.0 },
    { label: '  3.0-5.0%', min: 3.0, max: 5.0 },
    { label: '  5.0-10.0%', min: 5.0, max: 10.0 },
    { label: ' 10.0%+   ', min: 10.0, max: Infinity }
  ];

  console.log('\n--- ERROR DISTRIBUTION (|realized - simple_cash| %) ---\n');

  for (const bucket of buckets) {
    const count = validResults.filter(r => {
      const err = Math.abs(r.realized_vs_cash_pct_error);
      return err >= bucket.min && err < bucket.max;
    }).length;

    const pct = (count / validResults.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(count / validResults.length * 40));
    console.log(`${bucket.label}  ${count.toString().padStart(3)} wallets (${pct.padStart(5)}%) ${bar}`);
  }
}

async function generateMarkdownReport(
  results: ValidationResult[],
  stats: any,
  metadata: any,
  outliers: ValidationResult[]
) {
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  const avgDuration = results.reduce((sum, r) => sum + r.duration_ms, 0) / results.length;

  const report = `# V29 TRADER_STRICT Expanded Validation Report

**Date:** ${new Date().toISOString()}
**Sample Size:** ${results.length} wallets
**Concurrency:** ${metadata.concurrency}
**Total Runtime:** ${metadata.totalDuration}ms
**Avg per wallet:** ${avgDuration.toFixed(0)}ms

## Summary

| Metric | Value |
|--------|-------|
| Pass (<3% error) | ${passCount} (${(passCount/results.length*100).toFixed(1)}%) |
| Fail (>=3% error) | ${failCount} |
| Errors | ${errorCount} |

## Accuracy vs Simple Cash Flow

| Statistic | Value |
|-----------|-------|
| Median error | ${stats.median.toFixed(4)}% |
| Mean error | ${stats.mean.toFixed(4)}% |
| P90 error | ${stats.p90.toFixed(4)}% |
| P95 error | ${stats.p95.toFixed(4)}% |
| P99 error | ${stats.p99.toFixed(4)}% |
| Max error | ${stats.max.toFixed(4)}% |

## Interpretation

${passCount / results.length >= 0.90
  ? '✅ **COHORT HEALTHY**: V29 engine performs well on expanded TRADER_STRICT sample. The v2 rule generalizes beyond the original 10-wallet cohort.'
  : passCount / results.length >= 0.70
    ? '⚠️ **NEEDS ATTENTION**: Some systematic issues detected in the expanded cohort.'
    : '❌ **UNHEALTHY**: Major accuracy issues detected.'}

## Top 5 Outliers

${outliers.slice(0, 5).map((o, i) => `
### ${i + 1}. ${o.wallet}

- **V29 Realized:** $${o.v29_realized.toLocaleString()}
- **Simple Cash:** $${o.simple_cash_pnl.toLocaleString()}
- **Error:** ${o.realized_vs_cash_pct_error.toFixed(2)}%
- **Activity:** ${o.clob_count} CLOB, ${o.redemption_count} redemptions, ${o.distinct_conditions} markets
`).join('\n')}

## Next Steps

${failCount > 0
  ? `- Investigate ${failCount} failing wallets for common patterns\n- Check for mislabeled source_type in unified ledger\n- Review extreme redemption patterns`
  : '- V29 engine is production-ready for TRADER_STRICT wallets\n- Consider expanding to other wallet types'}

---
*Generated by validate-v29-on-trader-strict-sample-v2.ts*
`;

  const reportPath = path.join(process.cwd(), 'docs/reports/V29_TRADER_STRICT_EXPANDED_VALIDATION_2025_12_06.md');
  await fs.writeFile(reportPath, report);
  console.log(`\n📄 Markdown report saved to: ${reportPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
  const timeoutArg = args.find(a => a.startsWith('--wallet-timeout-ms='));
  const useFastSampleArg = args.find(a => a.startsWith('--use-fast-sample='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : 6;
  const walletTimeoutMs = timeoutArg ? parseInt(timeoutArg.split('=')[1]) : 20000;
  const useFastSample = useFastSampleArg ? useFastSampleArg.split('=')[1] === 'true' : true;

  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('   V29 VALIDATION - TRADER_STRICT SAMPLE v2 (FAST DEV MODE)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`⚙️  Configuration:`);
  console.log(`   Limit:            ${limit} wallets`);
  console.log(`   Concurrency:      ${concurrency}`);
  console.log(`   Wallet timeout:   ${walletTimeoutMs}ms`);
  console.log(`   Use fast sample:  ${useFastSample}`);
  console.log(`   Start time:       ${new Date().toISOString()}\n`);

  // Load candidate list
  const candidateFile = useFastSample
    ? 'trader_strict_sample_v2_fast.json'
    : 'trader_strict_candidates_v2_2025_12_06.json';
  const candidatePath = path.join(process.cwd(), 'tmp', candidateFile);
  const candidateData = JSON.parse(await fs.readFile(candidatePath, 'utf-8'));
  const allCandidates: WalletCandidate[] = candidateData.wallets;
  const candidates = allCandidates.slice(0, limit);

  console.log(`📁 Loaded ${candidates.length} candidate wallets (from ${allCandidates.length} total)`);
  console.log(`   Source: ${candidateFile}`);

  // Setup checkpoint
  const checkpointPath = path.join(process.cwd(), 'tmp/v29_trader_strict_validation_v2_results.jsonl');
  const completed = await loadCheckpoint(checkpointPath);

  const remaining = candidates.filter(c => !completed.has(c.wallet_address.toLowerCase()));
  console.log(`📋 Checkpoint: ${completed.size} already completed, ${remaining.length} remaining\n`);

  if (remaining.length === 0) {
    console.log('✅ All wallets already validated. Delete checkpoint to re-run.\n');
    process.exit(0);
  }

  // Batch load cash flow for ALL remaining wallets
  const walletAddresses = remaining.map(c => c.wallet_address);
  const cashFlowMap = await batchLoadCashFlow(walletAddresses);

  // BATCH PRELOAD V29 DATA (NEW!)
  const v29PreloadData = await preloadV29Data(walletAddresses);

  console.log(`\n🚀 Starting validation with concurrency=${concurrency}...\n`);

  const limiter = new ConcurrencyLimiter(concurrency);
  const results: ValidationResult[] = [];
  let completed_count = 0;
  const total = remaining.length;
  let totalDuration = 0;

  const promises = remaining.map((candidate, index) =>
    limiter.run(async () => {
      const result = await validateWallet(candidate, cashFlowMap, v29PreloadData, walletTimeoutMs);
      await appendCheckpoint(checkpointPath, result);

      completed_count++;
      totalDuration += result.duration_ms;
      const avgMs = totalDuration / completed_count;

      const statusIcon = result.status === 'pass' ? '✅' :
                        result.status === 'fail' ? '❌' :
                        result.error_message?.includes('TIMEOUT') ? '⏱️ ' : '⚠️ ';

      process.stdout.write(
        `  Progress: ${completed_count}/${total} | ` +
        `Avg: ${avgMs.toFixed(0)}ms/wallet | ` +
        `Last: ${statusIcon} ` +
        `${result.wallet.slice(0, 10)}... (${result.duration_ms}ms)\r`
      );

      return result;
    })
  );

  results.push(...await Promise.all(promises));

  const totalElapsed = Date.now() - startTime;
  console.log(`\n\n✅ Validation complete in ${totalElapsed}ms (${(totalElapsed/1000).toFixed(1)}s)\n`);

  // Load all results from checkpoint (including previously completed)
  const allResultsLines = (await fs.readFile(checkpointPath, 'utf-8')).trim().split('\n');
  const allResults: ValidationResult[] = allResultsLines.map(line => JSON.parse(line));

  // Compute statistics
  const passCount = allResults.filter(r => r.status === 'pass').length;
  const failCount = allResults.filter(r => r.status === 'fail').length;
  const errorCount = allResults.filter(r => r.status === 'error').length;

  const stats = computeDistributionStats(allResults);

  // Print summary table (top 20 best)
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
  console.log('WALLET                                      V29 Realized    Simple Cash    Error %   Status');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');

  const sortedByError = [...allResults]
    .filter(r => r.status !== 'error')
    .sort((a, b) => Math.abs(a.realized_vs_cash_pct_error) - Math.abs(b.realized_vs_cash_pct_error))
    .slice(0, 20);

  for (const r of sortedByError) {
    const realized = r.v29_realized.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const cash = r.simple_cash_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const error = r.realized_vs_cash_pct_error.toFixed(4).padStart(9);
    const status = r.status === 'pass' ? '✅' : '❌';
    console.log(`${r.wallet}  ${realized}  ${cash}  ${error}%  ${status}`);
  }

  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');

  // Print aggregate stats
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                         AGGREGATE STATS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`  Total wallets tested:       ${allResults.length}`);
  console.log(`  Pass (<3% error):         ${passCount} (${(passCount / allResults.length * 100).toFixed(1)}%)`);
  console.log(`  Fail (>=3% error):        ${failCount}`);
  console.log(`  Errors:                     ${errorCount}\n`);

  console.log(`  Mean |error| vs cash:       ${stats.mean.toFixed(4)}%`);
  console.log(`  Median |error| vs cash:     ${stats.median.toFixed(4)}%`);
  console.log(`  P90 |error| vs cash:        ${stats.p90.toFixed(4)}%`);
  console.log(`  P95 |error| vs cash:        ${stats.p95.toFixed(4)}%`);
  console.log(`  P99 |error| vs cash:        ${stats.p99.toFixed(4)}%`);
  console.log(`  Max |error| vs cash:        ${stats.max.toFixed(4)}%`);

  printDistribution(allResults);

  // Identify outliers (>3% error)
  const outliers = allResults.filter(r => r.status === 'fail').sort((a, b) =>
    Math.abs(b.realized_vs_cash_pct_error) - Math.abs(a.realized_vs_cash_pct_error)
  );

  if (outliers.length > 0) {
    console.log('\n--- TOP 5 OUTLIERS (>=3% error) ---\n');
    for (const outlier of outliers.slice(0, 5)) {
      console.log(`❌ ${outlier.wallet}`);
      console.log(`   V29 Realized: $${outlier.v29_realized.toLocaleString()}`);
      console.log(`   Simple Cash:  $${outlier.simple_cash_pnl.toLocaleString()}`);
      console.log(`   Error:        ${outlier.realized_vs_cash_pct_error.toFixed(2)}%`);
      console.log(`   Activity:     ${outlier.clob_count} CLOB, ${outlier.redemption_count} redemptions\n`);
    }
  }

  // Save JSON results
  const outputDir = path.join(process.cwd(), 'tmp');
  const outputPath = path.join(outputDir, 'v29_trader_strict_sample_v2_results_2025_12_06.json');
  await fs.writeFile(
    outputPath,
    JSON.stringify({
      metadata: {
        runDate: new Date().toISOString(),
        sampleSize: allResults.length,
        limit,
        concurrency,
        totalDuration: totalElapsed,
        passCount,
        failCount,
        errorCount,
        stats
      },
      results: allResults,
      outliers: outliers.slice(0, 20)
    }, null, 2)
  );

  console.log(`\n📄 JSON results saved to: ${outputPath}`);

  // Generate markdown report
  await generateMarkdownReport(allResults, stats, { concurrency, totalDuration: totalElapsed }, outliers);

  // Determine overall health
  const passRate = (passCount / allResults.length * 100);
  console.log('\n═══════════════════════════════════════════════════════════════════');
  if (passRate >= 90) {
    console.log('  ✅ COHORT HEALTHY: V29 engine performs well on expanded sample');
    console.log('     SAFE_TRADER_STRICT v2 rule generalizes beyond original 10 wallets');
  } else if (passRate >= 70) {
    console.log('  ⚠️  COHORT NEEDS ATTENTION: Some systematic issues detected');
  } else {
    console.log('  ❌ COHORT UNHEALTHY: Major accuracy issues detected');
  }
  console.log('═══════════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(console.error);
