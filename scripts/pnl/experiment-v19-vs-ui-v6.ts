/**
 * V19 Experiment - Clean Implementation on V6 Foundation
 *
 * Tests three variants of source inclusion against UI PnL:
 * 1. variant_clob_only: CLOB trades only (baseline - matches V18)
 * 2. variant_clob_mapped_only: CLOB trades with valid condition_id only (excludes unmapped)
 * 3. variant_all_sources: All sources in V6 (CLOB + CTF)
 *
 * Key insights from CTF debugger:
 * - PayoutRedemption creates phantom outcome_index=0 entries (double-counts winnings)
 * - Some token_ids are unmapped in pm_token_to_condition_map_v3
 * - For conditions with CLOB, CTF events should be excluded
 *
 * Canonical formula: total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';
const CLASSIFICATION_FILE = 'data/wallet-classification-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

async function calculatePnL(
  wallet: string,
  variant: 'clob_only' | 'clob_mapped_only' | 'all_sources'
): Promise<{ pnl: number; positions: number; resolved: number; unmapped: number }> {
  let sourceFilter = '';
  let conditionFilter = '';

  switch (variant) {
    case 'clob_only':
      sourceFilter = "AND source_type = 'CLOB'";
      break;
    case 'clob_mapped_only':
      sourceFilter = "AND source_type = 'CLOB'";
      conditionFilter = "AND condition_id IS NOT NULL AND condition_id != ''";
      break;
    case 'all_sources':
      // Include all - but this will have CTF issues
      break;
  }

  const query = `
    WITH
      -- Aggregate to position level
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) = lower('${wallet}')
          ${sourceFilter}
          ${conditionFilter}
        GROUP BY condition_id, outcome_index
      ),
      -- Calculate PnL per position
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          cash_flow,
          final_tokens,
          resolution_price,
          -- Total PnL = cash + tokens * resolution (0 if unresolved)
          cash_flow + if(resolution_price IS NOT NULL, final_tokens * resolution_price, 0) AS pos_total_pnl,
          if(resolution_price IS NOT NULL, 'resolved', 'unresolved') AS status,
          if(condition_id IS NULL OR condition_id = '', 1, 0) AS is_unmapped
        FROM positions
      )
    SELECT
      sum(round(pos_total_pnl, 2)) AS total_pnl,
      count() AS position_count,
      countIf(status = 'resolved') AS resolved_count,
      sumIf(1, is_unmapped = 1) AS unmapped_count
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { pnl: 0, positions: 0, resolved: 0, unmapped: 0 };
  }

  return {
    pnl: Number(rows[0].total_pnl) || 0,
    positions: Number(rows[0].position_count) || 0,
    resolved: Number(rows[0].resolved_count) || 0,
    unmapped: Number(rows[0].unmapped_count) || 0,
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function passCount(arr: number[], threshold: number): number {
  return arr.filter((e) => e <= threshold).length;
}

async function main() {
  console.log('='.repeat(140));
  console.log('V19 EXPERIMENT - CLEAN IMPLEMENTATION ON V6 FOUNDATION');
  console.log('='.repeat(140));
  console.log('');
  console.log('Canonical formula: total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)');
  console.log('');
  console.log('Variants:');
  console.log('  1. CLOB only: All CLOB trades including unmapped (baseline)');
  console.log('  2. CLOB mapped: CLOB trades with valid condition_id only');
  console.log('  3. All sources: All sources in V6 (shows CTF pollution)');
  console.log('');

  // Load benchmark data
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found at ' + REPORT_FILE);
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const benchmarks: Map<string, BenchmarkResult> = new Map();
  for (const r of report.results) {
    benchmarks.set(r.wallet.toLowerCase(), r);
  }

  // Load classification
  let walletClasses = new Map<string, string>();
  if (fs.existsSync(CLASSIFICATION_FILE)) {
    const classification = JSON.parse(fs.readFileSync(CLASSIFICATION_FILE, 'utf-8'));
    for (const w of classification.classifications || []) {
      walletClasses.set(w.wallet.toLowerCase(), w.class);
    }
  }

  console.log(`Loaded ${benchmarks.size} benchmark wallets.`);
  console.log('');

  // Results table header
  console.log(
    'Username       | Class      | UI PnL      | V18         | V18 Err | CLOB        | Err   | Mapped      | Err   | All Src     | Err   | Unmap'
  );
  console.log('-'.repeat(150));

  interface Result {
    wallet: string;
    username: string;
    walletClass: string;
    ui: number;
    v18: number;
    v18Err: number;
    clobOnly: number;
    clobOnlyErr: number;
    clobMapped: number;
    clobMappedErr: number;
    allSources: number;
    allSourcesErr: number;
    unmapped: number;
  }

  const results: Result[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const uiPnl = benchmark.ui?.pnl || 0;
    const v18Pnl = benchmark.v18?.total_pnl || 0;
    const username = benchmark.ui?.username || 'Unknown';
    const walletClass = walletClasses.get(wallet) || 'unknown';

    const [clobOnly, clobMapped, allSources] = await Promise.all([
      calculatePnL(wallet, 'clob_only'),
      calculatePnL(wallet, 'clob_mapped_only'),
      calculatePnL(wallet, 'all_sources'),
    ]);

    const result: Result = {
      wallet,
      username,
      walletClass,
      ui: uiPnl,
      v18: v18Pnl,
      v18Err: errorPct(v18Pnl, uiPnl),
      clobOnly: clobOnly.pnl,
      clobOnlyErr: errorPct(clobOnly.pnl, uiPnl),
      clobMapped: clobMapped.pnl,
      clobMappedErr: errorPct(clobMapped.pnl, uiPnl),
      allSources: allSources.pnl,
      allSourcesErr: errorPct(allSources.pnl, uiPnl),
      unmapped: clobOnly.unmapped,
    };

    results.push(result);

    // Print row
    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `${result.walletClass.substring(0, 10).padEnd(10)} | ` +
        `$${result.ui.toFixed(2).padStart(9)} | ` +
        `$${result.v18.toFixed(2).padStart(9)} | ` +
        `${result.v18Err.toFixed(1).padStart(5)}% | ` +
        `$${result.clobOnly.toFixed(2).padStart(9)} | ` +
        `${result.clobOnlyErr.toFixed(1).padStart(4)}% | ` +
        `$${result.clobMapped.toFixed(2).padStart(9)} | ` +
        `${result.clobMappedErr.toFixed(1).padStart(4)}% | ` +
        `$${result.allSources.toFixed(2).padStart(9)} | ` +
        `${result.allSourcesErr.toFixed(1).padStart(4)}% | ` +
        `${result.unmapped}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(150));
  console.log('SUMMARY BY ENGINE');
  console.log('='.repeat(150));

  const v18Errors = results.map((r) => r.v18Err);
  const clobOnlyErrors = results.map((r) => r.clobOnlyErr);
  const clobMappedErrors = results.map((r) => r.clobMappedErr);
  const allSourcesErrors = results.map((r) => r.allSourcesErr);

  console.log(`\n              | Median Err | Pass ≤1% | Pass ≤5% | Pass ≤10%`);
  console.log('-'.repeat(70));
  console.log(
    `V18 (current) | ${median(v18Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v18Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19 CLOB Only | ${median(clobOnlyErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(clobOnlyErrors, 1).toString().padStart(7)} | ` +
      `${passCount(clobOnlyErrors, 5).toString().padStart(7)} | ` +
      `${passCount(clobOnlyErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19 CLOB Map  | ${median(clobMappedErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(clobMappedErrors, 1).toString().padStart(7)} | ` +
      `${passCount(clobMappedErrors, 5).toString().padStart(7)} | ` +
      `${passCount(clobMappedErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19 All Src   | ${median(allSourcesErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(allSourcesErrors, 1).toString().padStart(7)} | ` +
      `${passCount(allSourcesErrors, 5).toString().padStart(7)} | ` +
      `${passCount(allSourcesErrors, 10).toString().padStart(8)}`
  );

  // By wallet class
  console.log('');
  console.log('='.repeat(150));
  console.log('SUMMARY BY WALLET CLASS');
  console.log('='.repeat(150));

  const clobOnly = results.filter((r) => r.walletClass === 'clob_only');
  const mixedCtf = results.filter((r) => r.walletClass === 'mixed_ctf_clob');

  if (clobOnly.length > 0) {
    console.log(`\nCLOB-only wallets (${clobOnly.length}):`);
    console.log('              | Median Err | Pass ≤1%');
    console.log('-'.repeat(40));
    console.log(`V18           | ${median(clobOnly.map((r) => r.v18Err)).toFixed(2).padStart(9)}% | ${passCount(clobOnly.map((r) => r.v18Err), 1)}`);
    console.log(`V19 CLOB Only | ${median(clobOnly.map((r) => r.clobOnlyErr)).toFixed(2).padStart(9)}% | ${passCount(clobOnly.map((r) => r.clobOnlyErr), 1)}`);
    console.log(`V19 CLOB Map  | ${median(clobOnly.map((r) => r.clobMappedErr)).toFixed(2).padStart(9)}% | ${passCount(clobOnly.map((r) => r.clobMappedErr), 1)}`);
  }

  if (mixedCtf.length > 0) {
    console.log(`\nMixed CTF+CLOB wallets (${mixedCtf.length}):`);
    console.log('              | Median Err | Pass ≤1%');
    console.log('-'.repeat(40));
    console.log(`V18           | ${median(mixedCtf.map((r) => r.v18Err)).toFixed(2).padStart(9)}% | ${passCount(mixedCtf.map((r) => r.v18Err), 1)}`);
    console.log(`V19 CLOB Only | ${median(mixedCtf.map((r) => r.clobOnlyErr)).toFixed(2).padStart(9)}% | ${passCount(mixedCtf.map((r) => r.clobOnlyErr), 1)}`);
    console.log(`V19 CLOB Map  | ${median(mixedCtf.map((r) => r.clobMappedErr)).toFixed(2).padStart(9)}% | ${passCount(mixedCtf.map((r) => r.clobMappedErr), 1)}`);
  }

  // Wallets with unmapped trades
  console.log('');
  console.log('='.repeat(150));
  console.log('WALLETS WITH UNMAPPED TRADES');
  console.log('='.repeat(150));

  const withUnmapped = results.filter((r) => r.unmapped > 0);
  for (const r of withUnmapped) {
    const improvement = r.clobOnlyErr - r.clobMappedErr;
    console.log(
      `${r.username.substring(0, 14).padEnd(14)}: ${r.unmapped} unmapped | ` +
        `CLOB=${r.clobOnlyErr.toFixed(1)}% → Mapped=${r.clobMappedErr.toFixed(1)}% (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%)`
    );
  }

  // Save results
  const outputFile = 'data/v19-experiment-report.json';
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        formula: 'total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)',
        summary: {
          v18: { median_err: median(v18Errors), pass_1pct: passCount(v18Errors, 1) },
          clob_only: { median_err: median(clobOnlyErrors), pass_1pct: passCount(clobOnlyErrors, 1) },
          clob_mapped: { median_err: median(clobMappedErrors), pass_1pct: passCount(clobMappedErrors, 1) },
          all_sources: { median_err: median(allSourcesErrors), pass_1pct: passCount(allSourcesErrors, 1) },
        },
        by_class: {
          clob_only: {
            count: clobOnly.length,
            v18_median_err: median(clobOnly.map((r) => r.v18Err)),
            v19_clob_only_median_err: median(clobOnly.map((r) => r.clobOnlyErr)),
          },
          mixed_ctf_clob: {
            count: mixedCtf.length,
            v18_median_err: median(mixedCtf.map((r) => r.v18Err)),
            v19_clob_only_median_err: median(mixedCtf.map((r) => r.clobOnlyErr)),
          },
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nResults saved to: ${outputFile}`);
}

main().catch(console.error);
