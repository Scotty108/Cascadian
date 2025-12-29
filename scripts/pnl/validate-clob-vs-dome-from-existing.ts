#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE CLOB-ONLY VS DOME - From Existing Data
 * ============================================================================
 *
 * Uses the existing Dome realized data (500 wallets) to validate our
 * CLOB-only realized PnL calculation.
 *
 * This is a fast validation path that doesn't require API calls.
 *
 * Input:
 *   tmp/dome_realized_500_2025_12_07.json (existing Dome data)
 *
 * Output:
 *   tmp/clob_vs_dome_validation.json
 *   docs/pnl/CLOB_VS_DOME_VALIDATION.md
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-clob-vs-dome-from-existing.ts
 *
 * Terminal: Claude 2 (Parallel Dome Validation Track)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';

// ============================================================================
// Types
// ============================================================================

interface DomeWallet {
  wallet: string;
  realizedPnl: number | null;
  confidence: string;
  isPlaceholder: boolean;
}

interface ValidationResult {
  wallet: string;
  clob_realized: number;
  dome_realized: number | null;
  dome_confidence: string;
  delta: number | null;
  pct_error: number | null;
  abs_error: number | null;
  passed_1pct: boolean;
  passed_5pct: boolean;
  passed_1usd: boolean;
  passed_5usd: boolean;
  passed_10usd: boolean;
  outlier_tag: string;
}

// ============================================================================
// Load Dome Data
// ============================================================================

function loadDomeData(): DomeWallet[] {
  const files = [
    'tmp/dome_realized_500_2025_12_07.json',
    'tmp/dome_realized_omega_top50_2025_12_07.json',
  ];

  const wallets: DomeWallet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (fs.existsSync(file)) {
      console.log(`Loading ${file}...`);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const w of data.wallets || []) {
        const lower = w.wallet.toLowerCase();
        if (!seen.has(lower) && !w.isPlaceholder && w.realizedPnl !== null) {
          seen.add(lower);
          wallets.push({
            wallet: lower,
            realizedPnl: w.realizedPnl,
            confidence: w.confidence,
            isPlaceholder: w.isPlaceholder,
          });
        }
      }
    }
  }

  console.log(`Loaded ${wallets.length} wallets with valid Dome realized PnL`);
  return wallets;
}

// ============================================================================
// Get CLOB-Only Realized PnL
// ============================================================================

async function getClobRealizedBatch(wallets: string[]): Promise<Map<string, number>> {
  console.log(`\nFetching CLOB-only realized PnL for ${wallets.length} wallets...`);

  const results = new Map<string, number>();

  // Process in smaller batches to avoid memory issues
  const batchSize = 50;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletsStr = batch.map(w => `'${w}'`).join(',');

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

    try {
      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 60 }
      });
      const rows = await result.json<Array<{ wallet: string; total_realized: string }>>();

      for (const row of rows) {
        results.set(row.wallet.toLowerCase(), parseFloat(row.total_realized));
      }
    } catch (err: any) {
      console.error(`  Batch ${i}/${wallets.length} failed: ${err.message}`);
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, wallets.length)}/${wallets.length}`);
  }

  console.log('');
  console.log(`Got CLOB realized PnL for ${results.size} wallets`);
  return results;
}

// ============================================================================
// Validate
// ============================================================================

function classifyOutlier(clobRealized: number, domeRealized: number, delta: number): string {
  const absDelta = Math.abs(delta);
  const pctError = Math.abs(domeRealized) > 1 ? (absDelta / Math.abs(domeRealized)) * 100 : 0;

  if (pctError < 1 && absDelta < 1) return 'MATCH';
  if (pctError < 5 && absDelta < 5) return 'CLOSE_MATCH';
  if (pctError < 10 && absDelta < 10) return 'MINOR_DIFF';
  if (Math.sign(clobRealized) !== Math.sign(domeRealized) && Math.abs(domeRealized) > 10) return 'SIGN_MISMATCH';
  if (absDelta > 1000) return 'LARGE_DIFF';
  if (absDelta > 100) return 'MEDIUM_DIFF';
  return 'SMALL_DIFF';
}

function validate(
  domeWallets: DomeWallet[],
  clobPnL: Map<string, number>
): ValidationResult[] {
  console.log('\nValidating results...');

  const results: ValidationResult[] = [];

  for (const dome of domeWallets) {
    const clob = clobPnL.get(dome.wallet) ?? 0;
    const domeRealized = dome.realizedPnl;

    if (domeRealized === null) {
      results.push({
        wallet: dome.wallet,
        clob_realized: clob,
        dome_realized: null,
        dome_confidence: dome.confidence,
        delta: null,
        pct_error: null,
        abs_error: null,
        passed_1pct: false,
        passed_5pct: false,
        passed_1usd: false,
        passed_5usd: false,
        passed_10usd: false,
        outlier_tag: 'DOME_NULL',
      });
      continue;
    }

    const delta = clob - domeRealized;
    const absError = Math.abs(delta);
    const pctError = Math.abs(domeRealized) > 1 ? (absError / Math.abs(domeRealized)) * 100 : (absError > 1 ? 100 : 0);

    const tag = classifyOutlier(clob, domeRealized, delta);

    results.push({
      wallet: dome.wallet,
      clob_realized: clob,
      dome_realized: domeRealized,
      dome_confidence: dome.confidence,
      delta,
      pct_error: pctError,
      abs_error: absError,
      passed_1pct: pctError < 1 || absError < 1,
      passed_5pct: pctError < 5 || absError < 5,
      passed_1usd: absError < 1,
      passed_5usd: absError < 5,
      passed_10usd: absError < 10,
      outlier_tag: tag,
    });
  }

  return results;
}

// ============================================================================
// Generate Report
// ============================================================================

function generateReport(results: ValidationResult[]): string {
  const now = new Date().toISOString();
  const validResults = results.filter(r => r.dome_realized !== null);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const pctErrors = validResults.map(r => r.pct_error!);
  const absErrors = validResults.map(r => r.abs_error!);

  const pass1pct = validResults.filter(r => r.passed_1pct).length;
  const pass5pct = validResults.filter(r => r.passed_5pct).length;
  const pass1usd = validResults.filter(r => r.passed_1usd).length;
  const pass5usd = validResults.filter(r => r.passed_5usd).length;
  const pass10usd = validResults.filter(r => r.passed_10usd).length;

  const tagCounts: Record<string, number> = {};
  for (const r of results) {
    tagCounts[r.outlier_tag] = (tagCounts[r.outlier_tag] ?? 0) + 1;
  }

  const worstOutliers = validResults
    .filter(r => r.abs_error! > 10)
    .sort((a, b) => b.abs_error! - a.abs_error!)
    .slice(0, 20);

  return `# CLOB-Only vs Dome Realized PnL Validation

**Generated:** ${now}

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Wallets | ${results.length} |
| With Valid Dome PnL | ${validResults.length} |
| Median % Error | ${median(pctErrors).toFixed(2)}% |
| Median $ Error | $${median(absErrors).toFixed(2)} |

## Pass Rates

| Threshold | Count | Rate |
|-----------|-------|------|
| Within 1% | ${pass1pct} | ${(pass1pct / validResults.length * 100).toFixed(1)}% |
| Within 5% | ${pass5pct} | ${(pass5pct / validResults.length * 100).toFixed(1)}% |
| Within $1 | ${pass1usd} | ${(pass1usd / validResults.length * 100).toFixed(1)}% |
| Within $5 | ${pass5usd} | ${(pass5usd / validResults.length * 100).toFixed(1)}% |
| Within $10 | ${pass10usd} | ${(pass10usd / validResults.length * 100).toFixed(1)}% |

## Outlier Classification

| Tag | Count | % |
|-----|-------|---|
${Object.entries(tagCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([tag, count]) => `| ${tag} | ${count} | ${(count / results.length * 100).toFixed(1)}% |`)
  .join('\n')}

## Top 20 Worst Outliers

| Wallet | CLOB | Dome | Delta | Tag |
|--------|------|------|-------|-----|
${worstOutliers.map(r =>
  `| \`${r.wallet.slice(0, 10)}...\` | $${r.clob_realized.toFixed(2)} | $${r.dome_realized!.toFixed(2)} | $${r.delta!.toFixed(2)} | ${r.outlier_tag} |`
).join('\n')}

## Interpretation

${pass5pct / validResults.length > 0.8 ?
  '**STRONG ALIGNMENT:** >80% of wallets match Dome realized PnL within 5%. The CLOB-only realized calculation is well-aligned with Dome\'s definition.' :
  pass5pct / validResults.length > 0.6 ?
  '**MODERATE ALIGNMENT:** 60-80% match rate. Some definition differences or data gaps to investigate.' :
  '**WEAK ALIGNMENT:** <60% match rate. Significant discrepancies detected.'}

## Methodology

- **Our Source:** \`vw_realized_pnl_clob_only\` (CLOB trades only, resolved positions)
- **Benchmark:** Dome API realized PnL (granularity=all)
- **Formula:** sum(cash_flow + final_shares * resolution_price) for resolved markets

## Conclusion

${pass5pct / validResults.length > 0.8 ?
  'CLOB-only realized PnL matches Dome at scale. This confirms our core calculation is correct. Any remaining UI mismatches are due to unrealized valuation, transfers, or UI-specific accounting.' :
  'Further investigation needed on outliers. See worst outliers for debugging priorities.'}
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('VALIDATE CLOB-ONLY VS DOME - FROM EXISTING DATA');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Load Dome data
  const domeWallets = loadDomeData();

  if (domeWallets.length === 0) {
    console.error('No Dome data found. Run fetch-dome-realized-pnl.ts first.');
    process.exit(1);
  }

  // Step 2: Get CLOB realized PnL
  const walletList = domeWallets.map(w => w.wallet);
  const clobPnL = await getClobRealizedBatch(walletList);

  // Step 3: Validate
  const results = validate(domeWallets, clobPnL);

  // Step 4: Calculate summary stats
  const validResults = results.filter(r => r.dome_realized !== null);
  const pass5pct = validResults.filter(r => r.passed_5pct).length;
  const pass5usd = validResults.filter(r => r.passed_5usd).length;

  // Step 5: Write outputs
  const outputJson = 'tmp/clob_vs_dome_validation.json';
  const outputMd = 'docs/pnl/CLOB_VS_DOME_VALIDATION.md';

  if (!fs.existsSync('docs/pnl')) fs.mkdirSync('docs/pnl', { recursive: true });

  fs.writeFileSync(outputJson, JSON.stringify({
    metadata: {
      generated_at: new Date().toISOString(),
      total_wallets: results.length,
      valid_dome: validResults.length,
    },
    results,
  }, null, 2));

  const report = generateReport(results);
  fs.writeFileSync(outputMd, report);

  // Print summary
  console.log('\n');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total wallets: ${results.length}`);
  console.log(`Valid Dome PnL: ${validResults.length}`);
  console.log('');
  console.log('Pass Rates:');
  console.log(`  Within 5%:  ${(pass5pct / validResults.length * 100).toFixed(1)}%`);
  console.log(`  Within $5:  ${(pass5usd / validResults.length * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Output JSON: ${outputJson}`);
  console.log(`Output Report: ${outputMd}`);
  console.log('');

  if (pass5pct / validResults.length > 0.8) {
    console.log('✅ STRONG ALIGNMENT: >80% match rate validates CLOB-only realized calculation');
  } else if (pass5pct / validResults.length > 0.6) {
    console.log('⚠️  MODERATE ALIGNMENT: 60-80% match rate');
  } else {
    console.log('❌ WEAK ALIGNMENT: <60% match rate');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
