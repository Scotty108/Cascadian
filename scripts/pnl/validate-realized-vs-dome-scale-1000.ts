#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE REALIZED VS DOME - Scale 1000 Wallets
 * ============================================================================
 *
 * Large-scale realized PnL validation against Dome ground truth.
 * Uses vw_realized_pnl_clob_only view as the ClickHouse baseline.
 *
 * This is a "fast confidence" track that validates definition alignment
 * for realized PnL only (no synthetic resolutions, no unrealized).
 *
 * Cohorts:
 *   - Top 333 by activity (most trades)
 *   - Top 333 by |realized| (highest absolute PnL)
 *   - 334 random wallets
 *
 * Output:
 *   - tmp/realized_vs_dome_scale_1000.json
 *   - docs/pnl/REALIZED_VS_DOME_SCALE_1000.md
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-realized-vs-dome-scale-1000.ts
 *   npx tsx scripts/pnl/validate-realized-vs-dome-scale-1000.ts --wallet-count=500
 *   npx tsx scripts/pnl/validate-realized-vs-dome-scale-1000.ts --skip-fetch
 *
 * Terminal: Claude 2 (Parallel Dome Validation Track)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';
import { fetchDomeRealizedPnL, DomeRealizedResult, clearDomeCache } from '../../lib/pnl/domeClient';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let walletCount = 1000;
let skipFetch = false;
let concurrency = 10;

for (const arg of args) {
  if (arg.startsWith('--wallet-count=')) walletCount = parseInt(arg.split('=')[1]);
  if (arg === '--skip-fetch') skipFetch = true;
  if (arg.startsWith('--concurrency=')) concurrency = parseInt(arg.split('=')[1]);
}

// ============================================================================
// Types
// ============================================================================

interface WalletSample {
  wallet: string;
  cohort: 'top_activity' | 'top_realized' | 'random';
  trade_count?: number;
  clob_realized?: number;
}

interface ValidationResult {
  wallet: string;
  cohort: string;
  clob_realized: number;
  dome_realized: number | null;
  dome_confidence: string;
  delta: number | null;
  pct_error: number | null;
  abs_error: number | null;
  passed_1pct: boolean;
  passed_2pct: boolean;
  passed_5pct: boolean;
  passed_1usd: boolean;
  passed_5usd: boolean;
  passed_10usd: boolean;
  outlier_tag?: string;
}

interface ValidationSummary {
  total_wallets: number;
  dome_valid: number;
  dome_placeholder: number;
  dome_error: number;
  by_cohort: Record<string, CohortStats>;
  by_threshold: {
    within_1pct: { count: number; rate: number };
    within_2pct: { count: number; rate: number };
    within_5pct: { count: number; rate: number };
    within_1usd: { count: number; rate: number };
    within_5usd: { count: number; rate: number };
    within_10usd: { count: number; rate: number };
  };
  median_pct_error: number;
  median_abs_error: number;
  worst_outliers: Array<{
    wallet: string;
    clob: number;
    dome: number;
    delta: number;
    tag: string;
  }>;
}

interface CohortStats {
  total: number;
  dome_valid: number;
  pass_rate_1pct: number;
  pass_rate_5usd: number;
  median_pct_error: number;
}

// ============================================================================
// Step 1: Build Wallet Sample
// ============================================================================

async function buildWalletSample(count: number): Promise<WalletSample[]> {
  const perCohort = Math.floor(count / 3);
  const randomCount = count - 2 * perCohort;

  console.log(`Building ${count}-wallet sample...`);
  console.log(`  - Top activity: ${perCohort}`);
  console.log(`  - Top |realized|: ${perCohort}`);
  console.log(`  - Random: ${randomCount}`);

  // Use pm_trader_events_v2 directly for faster query (dedupe inline)
  // Get top by activity (most trades)
  const activityQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count(DISTINCT event_id) as trade_count
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY lower(trader_wallet)
    ORDER BY trade_count DESC
    LIMIT ${perCohort}
  `;

  console.log('  Fetching top activity wallets...');
  const activityResult = await clickhouse.query({
    query: activityQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const topActivity = await activityResult.json<Array<{ wallet: string; trade_count: string }>>();
  const activityWallets = new Set(topActivity.map(w => w.wallet.toLowerCase()));
  console.log(`  Got ${topActivity.length} activity wallets`);

  // Get top by |realized| using pre-aggregated data
  const realizedQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      sum(
        multiIf(side = 'buy', -toFloat64(usdc_amount), toFloat64(usdc_amount))
      ) / 1000000.0 as total_cash_flow
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY lower(trader_wallet)
    ORDER BY abs(total_cash_flow) DESC
    LIMIT ${perCohort * 2}
  `;

  console.log('  Fetching top realized wallets...');
  const realizedResult = await clickhouse.query({
    query: realizedQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const topRealized = await realizedResult.json<Array<{ wallet: string; total_cash_flow: string }>>();
  console.log(`  Got ${topRealized.length} realized candidates`);

  // Filter out wallets already in activity cohort
  const realizedWallets: WalletSample[] = [];
  for (const w of topRealized) {
    if (!activityWallets.has(w.wallet.toLowerCase()) && realizedWallets.length < perCohort) {
      realizedWallets.push({
        wallet: w.wallet.toLowerCase(),
        cohort: 'top_realized',
        clob_realized: parseFloat(w.total_cash_flow),
      });
    }
  }
  const realizedSet = new Set(realizedWallets.map(w => w.wallet));

  // Get random wallets (excluding activity and realized cohorts)
  const randomQuery = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    ORDER BY rand()
    LIMIT ${randomCount * 3}
  `;

  console.log('  Fetching random wallets...');
  const randomResult = await clickhouse.query({
    query: randomQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const randomCandidates = await randomResult.json<Array<{ wallet: string }>>();
  console.log(`  Got ${randomCandidates.length} random candidates`);

  const randomWallets: WalletSample[] = [];
  for (const w of randomCandidates) {
    const lower = w.wallet.toLowerCase();
    if (!activityWallets.has(lower) && !realizedSet.has(lower) && randomWallets.length < randomCount) {
      randomWallets.push({
        wallet: lower,
        cohort: 'random',
      });
    }
  }

  // Combine all samples
  const sample: WalletSample[] = [
    ...topActivity.map(w => ({
      wallet: w.wallet.toLowerCase(),
      cohort: 'top_activity' as const,
      trade_count: parseInt(w.trade_count),
    })),
    ...realizedWallets,
    ...randomWallets,
  ];

  console.log(`Built sample of ${sample.length} wallets`);
  return sample;
}

// ============================================================================
// Step 2: Get CLOB-Only Realized PnL from ClickHouse
// ============================================================================

async function getClobRealizedPnL(wallets: string[]): Promise<Map<string, number>> {
  console.log(`\nFetching CLOB-only realized PnL for ${wallets.length} wallets...`);

  const walletsStr = wallets.map(w => `'${w}'`).join(',');
  const query = `
    SELECT
      wallet,
      sum(realized_pnl_clob_only) as total_realized
    FROM vw_realized_pnl_clob_only
    WHERE is_resolved = 1
      AND realized_pnl_clob_only IS NOT NULL
      AND lower(wallet) IN (${walletsStr})
    GROUP BY wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<Array<{ wallet: string; total_realized: string }>>();

  const pnlMap = new Map<string, number>();
  for (const row of rows) {
    pnlMap.set(row.wallet.toLowerCase(), parseFloat(row.total_realized));
  }

  console.log(`Got CLOB realized PnL for ${pnlMap.size} wallets`);
  return pnlMap;
}

// ============================================================================
// Step 3: Fetch Dome Realized PnL
// ============================================================================

async function fetchDomeRealized(
  wallets: string[],
  concurrencyLimit: number
): Promise<Map<string, DomeRealizedResult>> {
  console.log(`\nFetching Dome realized PnL for ${wallets.length} wallets (concurrency=${concurrencyLimit})...`);

  clearDomeCache();
  const results = new Map<string, DomeRealizedResult>();
  let completed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < wallets.length; i += concurrencyLimit) {
    const batch = wallets.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map(wallet => fetchDomeRealizedPnL(wallet))
    );

    for (const result of batchResults) {
      results.set(result.wallet.toLowerCase(), result);
      if (result.error) errors++;
    }

    completed += batch.length;
    process.stdout.write(`\r  Progress: ${completed}/${wallets.length} (${errors} errors)`);
  }

  console.log('');
  return results;
}

// ============================================================================
// Step 4: Validate and Score
// ============================================================================

function classifyOutlier(clobRealized: number, domeRealized: number | null, delta: number | null): string {
  if (domeRealized === null || delta === null) return 'DOME_UNAVAILABLE';

  const absDelta = Math.abs(delta);
  const pctError = Math.abs(domeRealized) > 1 ? (absDelta / Math.abs(domeRealized)) * 100 : 0;

  // Classification logic
  if (pctError < 1 && absDelta < 1) return 'MATCH';
  if (pctError < 5 && absDelta < 5) return 'CLOSE_MATCH';
  if (pctError < 10 && absDelta < 10) return 'MINOR_DIFF';

  // Try to classify the difference
  if (Math.sign(clobRealized) !== Math.sign(domeRealized)) return 'SIGN_MISMATCH';
  if (absDelta > 1000) return 'LARGE_DIFF';
  if (absDelta > 100) return 'MEDIUM_DIFF';

  return 'SMALL_DIFF';
}

function validate(
  sample: WalletSample[],
  clobPnL: Map<string, number>,
  domePnL: Map<string, DomeRealizedResult>
): { results: ValidationResult[]; summary: ValidationSummary } {
  console.log('\nValidating results...');

  const results: ValidationResult[] = [];
  const cohortStats: Record<string, { total: number; valid: number; pctErrors: number[]; passCount1pct: number; passCount5usd: number }> = {
    top_activity: { total: 0, valid: 0, pctErrors: [], passCount1pct: 0, passCount5usd: 0 },
    top_realized: { total: 0, valid: 0, pctErrors: [], passCount1pct: 0, passCount5usd: 0 },
    random: { total: 0, valid: 0, pctErrors: [], passCount1pct: 0, passCount5usd: 0 },
  };

  let domeValid = 0;
  let domePlaceholder = 0;
  let domeError = 0;
  const allPctErrors: number[] = [];
  const allAbsErrors: number[] = [];

  for (const wallet of sample) {
    const clob = clobPnL.get(wallet.wallet) ?? 0;
    const dome = domePnL.get(wallet.wallet);

    cohortStats[wallet.cohort].total++;

    if (!dome || dome.isPlaceholder) {
      domePlaceholder++;
      results.push({
        wallet: wallet.wallet,
        cohort: wallet.cohort,
        clob_realized: clob,
        dome_realized: null,
        dome_confidence: dome?.confidence ?? 'none',
        delta: null,
        pct_error: null,
        abs_error: null,
        passed_1pct: false,
        passed_2pct: false,
        passed_5pct: false,
        passed_1usd: false,
        passed_5usd: false,
        passed_10usd: false,
        outlier_tag: 'DOME_UNAVAILABLE',
      });
      continue;
    }

    if (dome.error && dome.realizedPnl === null) {
      domeError++;
      results.push({
        wallet: wallet.wallet,
        cohort: wallet.cohort,
        clob_realized: clob,
        dome_realized: null,
        dome_confidence: 'none',
        delta: null,
        pct_error: null,
        abs_error: null,
        passed_1pct: false,
        passed_2pct: false,
        passed_5pct: false,
        passed_1usd: false,
        passed_5usd: false,
        passed_10usd: false,
        outlier_tag: 'DOME_ERROR',
      });
      continue;
    }

    domeValid++;
    cohortStats[wallet.cohort].valid++;

    const domeRealized = dome.realizedPnl!;
    const delta = clob - domeRealized;
    const absError = Math.abs(delta);
    const pctError = Math.abs(domeRealized) > 1 ? (absError / Math.abs(domeRealized)) * 100 : (absError > 1 ? 100 : 0);

    allPctErrors.push(pctError);
    allAbsErrors.push(absError);
    cohortStats[wallet.cohort].pctErrors.push(pctError);

    const passed1pct = pctError < 1 || absError < 1;
    const passed2pct = pctError < 2 || absError < 2;
    const passed5pct = pctError < 5 || absError < 5;
    const passed1usd = absError < 1;
    const passed5usd = absError < 5;
    const passed10usd = absError < 10;

    if (passed1pct) cohortStats[wallet.cohort].passCount1pct++;
    if (passed5usd) cohortStats[wallet.cohort].passCount5usd++;

    const tag = classifyOutlier(clob, domeRealized, delta);

    results.push({
      wallet: wallet.wallet,
      cohort: wallet.cohort,
      clob_realized: clob,
      dome_realized: domeRealized,
      dome_confidence: dome.confidence,
      delta,
      pct_error: pctError,
      abs_error: absError,
      passed_1pct: passed1pct,
      passed_2pct: passed2pct,
      passed_5pct: passed5pct,
      passed_1usd: passed1usd,
      passed_5usd: passed5usd,
      passed_10usd: passed10usd,
      outlier_tag: tag,
    });
  }

  // Calculate summary stats
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const validResults = results.filter(r => r.dome_realized !== null);

  const summary: ValidationSummary = {
    total_wallets: sample.length,
    dome_valid: domeValid,
    dome_placeholder: domePlaceholder,
    dome_error: domeError,
    by_cohort: {},
    by_threshold: {
      within_1pct: { count: validResults.filter(r => r.passed_1pct).length, rate: 0 },
      within_2pct: { count: validResults.filter(r => r.passed_2pct).length, rate: 0 },
      within_5pct: { count: validResults.filter(r => r.passed_5pct).length, rate: 0 },
      within_1usd: { count: validResults.filter(r => r.passed_1usd).length, rate: 0 },
      within_5usd: { count: validResults.filter(r => r.passed_5usd).length, rate: 0 },
      within_10usd: { count: validResults.filter(r => r.passed_10usd).length, rate: 0 },
    },
    median_pct_error: median(allPctErrors),
    median_abs_error: median(allAbsErrors),
    worst_outliers: [],
  };

  // Calculate rates
  if (domeValid > 0) {
    summary.by_threshold.within_1pct.rate = summary.by_threshold.within_1pct.count / domeValid;
    summary.by_threshold.within_2pct.rate = summary.by_threshold.within_2pct.count / domeValid;
    summary.by_threshold.within_5pct.rate = summary.by_threshold.within_5pct.count / domeValid;
    summary.by_threshold.within_1usd.rate = summary.by_threshold.within_1usd.count / domeValid;
    summary.by_threshold.within_5usd.rate = summary.by_threshold.within_5usd.count / domeValid;
    summary.by_threshold.within_10usd.rate = summary.by_threshold.within_10usd.count / domeValid;
  }

  // Cohort stats
  for (const [cohort, stats] of Object.entries(cohortStats)) {
    summary.by_cohort[cohort] = {
      total: stats.total,
      dome_valid: stats.valid,
      pass_rate_1pct: stats.valid > 0 ? stats.passCount1pct / stats.valid : 0,
      pass_rate_5usd: stats.valid > 0 ? stats.passCount5usd / stats.valid : 0,
      median_pct_error: median(stats.pctErrors),
    };
  }

  // Worst outliers
  summary.worst_outliers = validResults
    .filter(r => r.abs_error !== null && r.abs_error > 10)
    .sort((a, b) => (b.abs_error ?? 0) - (a.abs_error ?? 0))
    .slice(0, 20)
    .map(r => ({
      wallet: r.wallet,
      clob: r.clob_realized,
      dome: r.dome_realized!,
      delta: r.delta!,
      tag: r.outlier_tag ?? 'UNKNOWN',
    }));

  return { results, summary };
}

// ============================================================================
// Step 5: Generate Report
// ============================================================================

function generateReport(summary: ValidationSummary, results: ValidationResult[]): string {
  const now = new Date().toISOString();

  return `# Realized PnL vs Dome - Scale ${summary.total_wallets} Validation

**Generated:** ${now}

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Wallets | ${summary.total_wallets} |
| Dome Valid | ${summary.dome_valid} (${(summary.dome_valid / summary.total_wallets * 100).toFixed(1)}%) |
| Dome Placeholder | ${summary.dome_placeholder} |
| Dome Error | ${summary.dome_error} |

## Pass Rates (vs Dome Valid)

| Threshold | Count | Rate |
|-----------|-------|------|
| Within 1% | ${summary.by_threshold.within_1pct.count} | ${(summary.by_threshold.within_1pct.rate * 100).toFixed(1)}% |
| Within 2% | ${summary.by_threshold.within_2pct.count} | ${(summary.by_threshold.within_2pct.rate * 100).toFixed(1)}% |
| Within 5% | ${summary.by_threshold.within_5pct.count} | ${(summary.by_threshold.within_5pct.rate * 100).toFixed(1)}% |
| Within $1 | ${summary.by_threshold.within_1usd.count} | ${(summary.by_threshold.within_1usd.rate * 100).toFixed(1)}% |
| Within $5 | ${summary.by_threshold.within_5usd.count} | ${(summary.by_threshold.within_5usd.rate * 100).toFixed(1)}% |
| Within $10 | ${summary.by_threshold.within_10usd.count} | ${(summary.by_threshold.within_10usd.rate * 100).toFixed(1)}% |

## Error Statistics

- **Median % Error:** ${summary.median_pct_error.toFixed(2)}%
- **Median $ Error:** $${summary.median_abs_error.toFixed(2)}

## By Cohort

| Cohort | Total | Dome Valid | Pass Rate (1%) | Pass Rate ($5) | Median % Error |
|--------|-------|------------|----------------|----------------|----------------|
${Object.entries(summary.by_cohort).map(([cohort, stats]) =>
  `| ${cohort} | ${stats.total} | ${stats.dome_valid} | ${(stats.pass_rate_1pct * 100).toFixed(1)}% | ${(stats.pass_rate_5usd * 100).toFixed(1)}% | ${stats.median_pct_error.toFixed(2)}% |`
).join('\n')}

## Outlier Tags Distribution

| Tag | Count |
|-----|-------|
${Object.entries(
  results.reduce((acc, r) => {
    const tag = r.outlier_tag ?? 'UNKNOWN';
    acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>)
).sort((a, b) => b[1] - a[1]).map(([tag, count]) => `| ${tag} | ${count} |`).join('\n')}

## Top 20 Worst Outliers

| Wallet | CLOB | Dome | Delta | Tag |
|--------|------|------|-------|-----|
${summary.worst_outliers.map(o =>
  `| \`${o.wallet.slice(0, 10)}...\` | $${o.clob.toFixed(2)} | $${o.dome.toFixed(2)} | $${o.delta.toFixed(2)} | ${o.tag} |`
).join('\n')}

## Interpretation

${summary.by_threshold.within_5pct.rate > 0.8 ?
  '**STRONG ALIGNMENT:** >80% of wallets match Dome realized PnL within 5%. This validates that our CLOB-only realized calculation is aligned with Dome\'s definition.' :
  summary.by_threshold.within_5pct.rate > 0.6 ?
  '**MODERATE ALIGNMENT:** 60-80% of wallets match. There may be definition differences or data gaps to investigate.' :
  '**WEAK ALIGNMENT:** <60% match rate. Significant investigation needed to understand discrepancies.'}

## Methodology

- **Source:** \`vw_realized_pnl_clob_only\` view (CLOB trades only, no synthetic resolutions)
- **Benchmark:** Dome API \`/polymarket/wallet/pnl/{wallet}?granularity=all\`
- **Definition:** Realized PnL = sum of (cash flows + final_shares * resolution_price) for resolved positions only
- **Cohorts:**
  - Top activity: Wallets with most trades
  - Top |realized|: Wallets with largest absolute realized PnL
  - Random: Random sample excluding above

## Conclusion

${summary.by_threshold.within_5pct.rate > 0.8 ?
  'Realized PnL calculation is validated against Dome at scale. Any remaining UI mismatches are likely due to unrealized valuation, transfer handling, or UI-specific accounting rules.' :
  'Further investigation needed. See worst outliers for priority debugging targets.'}
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('VALIDATE REALIZED VS DOME - SCALE 1000');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet count: ${walletCount}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Skip fetch: ${skipFetch}`);
  console.log('');

  // Step 1: Build sample
  const sample = await buildWalletSample(walletCount);

  // Step 2: Get CLOB realized PnL
  const walletList = sample.map(w => w.wallet);
  const clobPnL = await getClobRealizedPnL(walletList);

  // Step 3: Fetch Dome realized PnL
  let domePnL: Map<string, DomeRealizedResult>;

  if (skipFetch) {
    // Try to load from cache
    const cacheFile = 'tmp/dome_realized_scale_1000_cache.json';
    if (fs.existsSync(cacheFile)) {
      console.log('\nLoading Dome results from cache...');
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      domePnL = new Map(Object.entries(cached));
    } else {
      console.log('\nNo cache found, fetching from Dome...');
      domePnL = await fetchDomeRealized(walletList, concurrency);
      // Save cache
      const cacheObj: Record<string, DomeRealizedResult> = {};
      for (const [k, v] of domePnL) cacheObj[k] = v;
      fs.writeFileSync(cacheFile, JSON.stringify(cacheObj, null, 2));
    }
  } else {
    domePnL = await fetchDomeRealized(walletList, concurrency);
    // Save cache
    const cacheFile = 'tmp/dome_realized_scale_1000_cache.json';
    const cacheObj: Record<string, DomeRealizedResult> = {};
    for (const [k, v] of domePnL) cacheObj[k] = v;
    fs.writeFileSync(cacheFile, JSON.stringify(cacheObj, null, 2));
  }

  // Step 4: Validate
  const { results, summary } = validate(sample, clobPnL, domePnL);

  // Step 5: Write outputs
  const outputJson = 'tmp/realized_vs_dome_scale_1000.json';
  const outputMd = 'docs/pnl/REALIZED_VS_DOME_SCALE_1000.md';

  // Ensure directories exist
  if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');
  if (!fs.existsSync('docs/pnl')) fs.mkdirSync('docs/pnl', { recursive: true });

  fs.writeFileSync(outputJson, JSON.stringify({
    metadata: {
      generated_at: new Date().toISOString(),
      wallet_count: walletCount,
      concurrency,
    },
    summary,
    results,
  }, null, 2));

  const report = generateReport(summary, results);
  fs.writeFileSync(outputMd, report);

  // Print summary
  console.log('\n');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total wallets: ${summary.total_wallets}`);
  console.log(`Dome valid: ${summary.dome_valid} (${(summary.dome_valid / summary.total_wallets * 100).toFixed(1)}%)`);
  console.log(`Dome placeholder: ${summary.dome_placeholder}`);
  console.log(`Dome error: ${summary.dome_error}`);
  console.log('');
  console.log('Pass Rates:');
  console.log(`  Within 1%:  ${(summary.by_threshold.within_1pct.rate * 100).toFixed(1)}%`);
  console.log(`  Within 5%:  ${(summary.by_threshold.within_5pct.rate * 100).toFixed(1)}%`);
  console.log(`  Within $5:  ${(summary.by_threshold.within_5usd.rate * 100).toFixed(1)}%`);
  console.log(`  Within $10: ${(summary.by_threshold.within_10usd.rate * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Median % error: ${summary.median_pct_error.toFixed(2)}%`);
  console.log(`Median $ error: $${summary.median_abs_error.toFixed(2)}`);
  console.log('');
  console.log(`Output JSON: ${outputJson}`);
  console.log(`Output Report: ${outputMd}`);
  console.log('');

  // Print interpretation
  if (summary.by_threshold.within_5pct.rate > 0.8) {
    console.log('✅ STRONG ALIGNMENT: >80% match rate validates realized PnL calculation');
  } else if (summary.by_threshold.within_5pct.rate > 0.6) {
    console.log('⚠️  MODERATE ALIGNMENT: 60-80% match rate - some investigation needed');
  } else {
    console.log('❌ WEAK ALIGNMENT: <60% match rate - significant discrepancies detected');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
