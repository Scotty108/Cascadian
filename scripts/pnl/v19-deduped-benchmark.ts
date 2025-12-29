/**
 * V19 Benchmark with Proper Deduplication
 *
 * The unified ledger (pm_unified_ledger_v5) has duplicate CLOB rows.
 * This script tests V19 variants with proper deduplication.
 *
 * Variants:
 * - V19A: All source_types, deduped by (event_id, outcome_index)
 * - V19B: Exclude PositionSplit, deduped
 * - V19C: CLOB + PayoutRedemption only, deduped
 * - V19D: CLOB only, deduped (should match V18)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

async function calculateV19Variants(wallet: string) {
  // Step 1: Get deduped ledger entries aggregated to position level
  const query = `
    WITH
      -- First dedupe by (event_id, outcome_index, source_type) to remove duplicate rows
      deduped_events AS (
        SELECT
          event_id,
          source_type,
          condition_id,
          outcome_index,
          any(usdc_delta) as usdc_delta,
          any(token_delta) as token_delta,
          any(payout_norm) as payout_norm
        FROM pm_unified_ledger_v5
        WHERE lower(wallet_address) = lower('${wallet}')
        GROUP BY event_id, source_type, condition_id, outcome_index
      ),
      -- Aggregate to position level with source-specific sums
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          -- All sources
          sum(usdc_delta) as usdc_all,
          sum(token_delta) as tokens_all,
          -- CLOB only
          sumIf(usdc_delta, source_type = 'CLOB') as usdc_clob,
          sumIf(token_delta, source_type = 'CLOB') as tokens_clob,
          -- CLOB + PayoutRedemption
          sumIf(usdc_delta, source_type IN ('CLOB', 'PayoutRedemption')) as usdc_clob_payout,
          sumIf(token_delta, source_type IN ('CLOB', 'PayoutRedemption')) as tokens_clob_payout,
          -- Exclude PositionSplit (all except PositionSplit)
          sumIf(usdc_delta, source_type != 'PositionSplit') as usdc_no_split,
          sumIf(token_delta, source_type != 'PositionSplit') as tokens_no_split,
          -- Resolution (use any since same for all rows in position)
          any(payout_norm) as resolution
        FROM deduped_events
        GROUP BY condition_id, outcome_index
      )
    SELECT
      -- V19A: All sources (deduped)
      sum(CASE
        WHEN resolution IS NOT NULL THEN usdc_all + tokens_all * resolution
        ELSE usdc_all + tokens_all * 0.5
      END) as v19a_pnl,

      -- V19B: Exclude PositionSplit
      sum(CASE
        WHEN resolution IS NOT NULL THEN usdc_no_split + tokens_no_split * resolution
        ELSE usdc_no_split + tokens_no_split * 0.5
      END) as v19b_pnl,

      -- V19C: CLOB + PayoutRedemption only
      sum(CASE
        WHEN resolution IS NOT NULL THEN usdc_clob_payout + tokens_clob_payout * resolution
        ELSE usdc_clob_payout + tokens_clob_payout * 0.5
      END) as v19c_pnl,

      -- V19D: CLOB only (should match V18)
      sum(CASE
        WHEN resolution IS NOT NULL THEN usdc_clob + tokens_clob * resolution
        ELSE usdc_clob + tokens_clob * 0.5
      END) as v19d_pnl,

      -- Debug: position counts
      count() as position_count
    FROM positions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { v19a: 0, v19b: 0, v19c: 0, v19d: 0, positions: 0 };
  }

  return {
    v19a: Number(rows[0].v19a_pnl) || 0,
    v19b: Number(rows[0].v19b_pnl) || 0,
    v19c: Number(rows[0].v19c_pnl) || 0,
    v19d: Number(rows[0].v19d_pnl) || 0,
    positions: Number(rows[0].position_count) || 0,
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

async function main() {
  console.log('='.repeat(140));
  console.log('V19 BENCHMARK WITH PROPER DEDUPLICATION');
  console.log('='.repeat(140));

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

  console.log(`\nAnalyzing ${benchmarks.size} wallets...\n`);

  // Results table header
  console.log(
    'Username       | UI PnL      | V18         | V18 Err | V19A(all)   | Err   | V19B(-Spl)  | Err   | V19C(CLOB+P)| Err   | V19D(CLOB)  | Err'
  );
  console.log('-'.repeat(140));

  const results: {
    wallet: string;
    username: string;
    ui: number;
    v18: number;
    v18Err: number;
    v19a: number;
    v19aErr: number;
    v19b: number;
    v19bErr: number;
    v19c: number;
    v19cErr: number;
    v19d: number;
    v19dErr: number;
  }[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const uiPnl = benchmark.ui?.pnl || 0;
    const v18Pnl = benchmark.v18?.total_pnl || 0;
    const username = benchmark.ui?.username || 'Unknown';

    const variants = await calculateV19Variants(wallet);

    const result = {
      wallet,
      username,
      ui: uiPnl,
      v18: v18Pnl,
      v18Err: errorPct(v18Pnl, uiPnl),
      v19a: variants.v19a,
      v19aErr: errorPct(variants.v19a, uiPnl),
      v19b: variants.v19b,
      v19bErr: errorPct(variants.v19b, uiPnl),
      v19c: variants.v19c,
      v19cErr: errorPct(variants.v19c, uiPnl),
      v19d: variants.v19d,
      v19dErr: errorPct(variants.v19d, uiPnl),
    };

    results.push(result);

    // Print row
    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `$${result.ui.toFixed(2).padStart(9)} | ` +
        `$${result.v18.toFixed(2).padStart(9)} | ` +
        `${result.v18Err.toFixed(1).padStart(5)}% | ` +
        `$${result.v19a.toFixed(2).padStart(9)} | ` +
        `${result.v19aErr.toFixed(1).padStart(4)}% | ` +
        `$${result.v19b.toFixed(2).padStart(9)} | ` +
        `${result.v19bErr.toFixed(1).padStart(4)}% | ` +
        `$${result.v19c.toFixed(2).padStart(9)} | ` +
        `${result.v19cErr.toFixed(1).padStart(4)}% | ` +
        `$${result.v19d.toFixed(2).padStart(9)} | ` +
        `${result.v19dErr.toFixed(1).padStart(4)}%`
    );
  }

  // Summary statistics
  console.log('\n' + '='.repeat(140));
  console.log('SUMMARY');
  console.log('='.repeat(140));

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) =>
    arr.filter((e) => e <= threshold).length;

  const v18Errors = results.map((r) => r.v18Err);
  const v19aErrors = results.map((r) => r.v19aErr);
  const v19bErrors = results.map((r) => r.v19bErr);
  const v19cErrors = results.map((r) => r.v19cErr);
  const v19dErrors = results.map((r) => r.v19dErr);

  console.log(`\n              | Median Err | Pass ≤1% | Pass ≤5% | Pass ≤10%`);
  console.log('-'.repeat(70));
  console.log(
    `V18 (current) | ${median(v18Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v18Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19A (all)    | ${median(v19aErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19aErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19aErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19aErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19B (-Split) | ${median(v19bErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19bErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19bErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19bErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19C (CLOB+P) | ${median(v19cErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19cErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19cErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19cErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19D (CLOB)   | ${median(v19dErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19dErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19dErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19dErrors, 10).toString().padStart(8)}`
  );

  console.log(`\nTotal wallets: ${results.length}`);

  // Identify best variant for each wallet
  console.log('\n' + '='.repeat(140));
  console.log('BEST VARIANT PER WALLET');
  console.log('='.repeat(140));

  let v18Wins = 0;
  let v19aWins = 0;
  let v19bWins = 0;
  let v19cWins = 0;
  let v19dWins = 0;

  for (const r of results) {
    const errors = [
      { name: 'V18', err: r.v18Err },
      { name: 'V19A', err: r.v19aErr },
      { name: 'V19B', err: r.v19bErr },
      { name: 'V19C', err: r.v19cErr },
      { name: 'V19D', err: r.v19dErr },
    ];
    const best = errors.reduce((a, b) => (a.err < b.err ? a : b));

    if (best.name === 'V18') v18Wins++;
    else if (best.name === 'V19A') v19aWins++;
    else if (best.name === 'V19B') v19bWins++;
    else if (best.name === 'V19C') v19cWins++;
    else if (best.name === 'V19D') v19dWins++;

    if (best.err < r.v18Err && r.v18Err > 1) {
      console.log(
        `${r.username.substring(0, 14).padEnd(14)}: ${best.name} (${best.err.toFixed(1)}%) beats V18 (${r.v18Err.toFixed(1)}%)`
      );
    }
  }

  console.log(`\nWin counts (best variant per wallet):`);
  console.log(`  V18:  ${v18Wins}`);
  console.log(`  V19A: ${v19aWins}`);
  console.log(`  V19B: ${v19bWins}`);
  console.log(`  V19C: ${v19cWins}`);
  console.log(`  V19D: ${v19dWins}`);

  // Save results
  const outputFile = 'data/v19-deduped-benchmark-report.json';
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        summary: {
          v18: { median_err: median(v18Errors), pass_1pct: passCount(v18Errors, 1) },
          v19a: { median_err: median(v19aErrors), pass_1pct: passCount(v19aErrors, 1) },
          v19b: { median_err: median(v19bErrors), pass_1pct: passCount(v19bErrors, 1) },
          v19c: { median_err: median(v19cErrors), pass_1pct: passCount(v19cErrors, 1) },
          v19d: { median_err: median(v19dErrors), pass_1pct: passCount(v19dErrors, 1) },
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
