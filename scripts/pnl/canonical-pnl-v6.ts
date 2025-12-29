/**
 * Canonical PnL Engine on Unified Ledger V6
 *
 * Implements the canonical PnL formula:
 * - realized_pnl = sum(usdc_delta) over included events
 * - final_token_balance = sum(token_delta) over included events
 * - unrealized_pnl = final_token_balance * resolution_price (0 if unresolved)
 * - total_pnl = realized_pnl + unrealized_pnl
 *
 * This script validates the formula against V18 and UI for CLOB-only wallets,
 * then we can experiment with different inclusion rules (adding CTF, etc.).
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

async function calculateCanonicalPnl(wallet: string, sourceTypes: string[] = ['CLOB']) {
  const sourceFilter = sourceTypes.map((s) => `'${s}'`).join(', ');

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
          AND source_type IN (${sourceFilter})
          AND condition_id IS NOT NULL
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
          -- Realized: cash flow only
          cash_flow AS realized_pnl,
          -- Unrealized: final_tokens * resolution_price (0 if unresolved)
          if(resolution_price IS NOT NULL,
             final_tokens * resolution_price,
             0) AS unrealized_pnl,
          -- Total
          cash_flow + if(resolution_price IS NOT NULL, final_tokens * resolution_price, 0) AS pos_total_pnl,
          -- Metadata
          if(resolution_price IS NOT NULL, 'resolved', 'unresolved') AS status
        FROM positions
      )
    SELECT
      -- Aggregates
      sum(realized_pnl) AS total_realized,
      sum(unrealized_pnl) AS total_unrealized,
      sum(pos_total_pnl) AS total_pnl,
      -- Rounded version (per-position rounding like V18)
      sum(round(pos_total_pnl, 2)) AS total_pnl_rounded,
      -- Counts
      count() AS position_count,
      countIf(status = 'resolved') AS resolved_count
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return {
      realized: 0,
      unrealized: 0,
      total: 0,
      totalRounded: 0,
      positions: 0,
      resolved: 0,
    };
  }

  return {
    realized: Number(rows[0].total_realized) || 0,
    unrealized: Number(rows[0].total_unrealized) || 0,
    total: Number(rows[0].total_pnl) || 0,
    totalRounded: Number(rows[0].total_pnl_rounded) || 0,
    positions: Number(rows[0].position_count) || 0,
    resolved: Number(rows[0].resolved_count) || 0,
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

async function main() {
  console.log('='.repeat(120));
  console.log('CANONICAL PnL ENGINE V6 - VALIDATION');
  console.log('='.repeat(120));
  console.log('');
  console.log('Formula: total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)');
  console.log('Testing CLOB-only first, then will add CTF sources.');
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
    'Username       | Class      | UI PnL      | V18         | V18 Err | V6-CLOB     | V6 Err  | Pos/Res'
  );
  console.log('-'.repeat(110));

  const results: {
    wallet: string;
    username: string;
    walletClass: string;
    ui: number;
    v18: number;
    v18Err: number;
    v6: number;
    v6Err: number;
    positions: number;
    resolved: number;
  }[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const uiPnl = benchmark.ui?.pnl || 0;
    const v18Pnl = benchmark.v18?.total_pnl || 0;
    const username = benchmark.ui?.username || 'Unknown';
    const walletClass = walletClasses.get(wallet) || 'unknown';

    const v6 = await calculateCanonicalPnl(wallet, ['CLOB']);

    const result = {
      wallet,
      username,
      walletClass,
      ui: uiPnl,
      v18: v18Pnl,
      v18Err: errorPct(v18Pnl, uiPnl),
      v6: v6.totalRounded,
      v6Err: errorPct(v6.totalRounded, uiPnl),
      positions: v6.positions,
      resolved: v6.resolved,
    };

    results.push(result);

    // Print row
    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `${result.walletClass.substring(0, 10).padEnd(10)} | ` +
        `$${result.ui.toFixed(2).padStart(9)} | ` +
        `$${result.v18.toFixed(2).padStart(9)} | ` +
        `${result.v18Err.toFixed(1).padStart(5)}% | ` +
        `$${result.v6.toFixed(2).padStart(9)} | ` +
        `${result.v6Err.toFixed(1).padStart(5)}% | ` +
        `${result.positions}/${result.resolved}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(110));
  console.log('SUMMARY');
  console.log('='.repeat(110));

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) =>
    arr.filter((e) => e <= threshold).length;

  const v18Errors = results.map((r) => r.v18Err);
  const v6Errors = results.map((r) => r.v6Err);

  console.log(`\n              | Median Err | Pass ≤1% | Pass ≤5% | Pass ≤10%`);
  console.log('-'.repeat(70));
  console.log(
    `V18 (current) | ${median(v18Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v18Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 10).toString().padStart(8)}`
  );
  console.log(
    `V6 CLOB-only  | ${median(v6Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v6Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v6Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v6Errors, 10).toString().padStart(8)}`
  );

  // By wallet class
  console.log('');
  console.log('BY WALLET CLASS:');
  console.log('-'.repeat(70));

  const clobOnly = results.filter((r) => r.walletClass === 'clob_only');
  const mixedCtf = results.filter((r) => r.walletClass === 'mixed_ctf_clob');

  if (clobOnly.length > 0) {
    const clobV18Errs = clobOnly.map((r) => r.v18Err);
    const clobV6Errs = clobOnly.map((r) => r.v6Err);
    console.log(`CLOB-only (${clobOnly.length} wallets):`);
    console.log(`  V18: median ${median(clobV18Errs).toFixed(2)}%, pass ≤1%: ${passCount(clobV18Errs, 1)}`);
    console.log(`  V6:  median ${median(clobV6Errs).toFixed(2)}%, pass ≤1%: ${passCount(clobV6Errs, 1)}`);
  }

  if (mixedCtf.length > 0) {
    const mixedV18Errs = mixedCtf.map((r) => r.v18Err);
    const mixedV6Errs = mixedCtf.map((r) => r.v6Err);
    console.log(`Mixed CTF+CLOB (${mixedCtf.length} wallets):`);
    console.log(`  V18: median ${median(mixedV18Errs).toFixed(2)}%, pass ≤1%: ${passCount(mixedV18Errs, 1)}`);
    console.log(`  V6:  median ${median(mixedV6Errs).toFixed(2)}%, pass ≤1%: ${passCount(mixedV6Errs, 1)}`);
  }

  console.log('');
  console.log(`Total wallets: ${results.length}`);

  // Check if V6 matches V18 for CLOB-only
  console.log('');
  console.log('='.repeat(110));
  console.log('V6 vs V18 COMPARISON FOR CLOB-ONLY WALLETS');
  console.log('='.repeat(110));

  for (const r of clobOnly) {
    const diff = Math.abs(r.v6 - r.v18);
    if (diff > 0.01) {
      console.log(
        `⚠️ ${r.username.substring(0, 14).padEnd(14)}: V18=$${r.v18.toFixed(2)}, V6=$${r.v6.toFixed(2)}, Diff=$${diff.toFixed(2)}`
      );
    } else {
      console.log(
        `✅ ${r.username.substring(0, 14).padEnd(14)}: V18=$${r.v18.toFixed(2)}, V6=$${r.v6.toFixed(2)} (match)`
      );
    }
  }

  // Save results
  const outputFile = 'data/canonical-pnl-v6-report.json';
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        formula: 'total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)',
        sources_included: ['CLOB'],
        summary: {
          v18: { median_err: median(v18Errors), pass_1pct: passCount(v18Errors, 1) },
          v6_clob: { median_err: median(v6Errors), pass_1pct: passCount(v6Errors, 1) },
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
