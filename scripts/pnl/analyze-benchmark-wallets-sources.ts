/**
 * Analyze Source Types for Benchmark Wallets
 *
 * Skips the expensive global aggregation and just analyzes benchmark wallets.
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

async function analyzeWallet(wallet: string, benchmark: BenchmarkResult | undefined) {
  const errorPct = benchmark?.total_pnl_error_pct || 0;
  const uiPnl = benchmark?.ui?.pnl || 0;
  const v18Pnl = benchmark?.v18?.total_pnl || 0;
  const username = benchmark?.ui?.username || 'Unknown';

  // Get source breakdown
  const q1 = `
    SELECT
      source_type,
      count() as rows,
      sum(usdc_delta) as sum_usdc,
      sum(token_delta) as sum_tokens
    FROM pm_unified_ledger_v5
    WHERE lower(wallet_address) = lower('${wallet}')
    GROUP BY source_type
    ORDER BY abs(sum_usdc) DESC
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];

  // Calculate V19 variants
  const q2 = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as usdc_all,
        sumIf(usdc_delta, source_type = 'CLOB') as usdc_clob,
        sumIf(usdc_delta, source_type IN ('CLOB', 'PayoutRedemption')) as usdc_clob_payout,
        sum(token_delta) as tokens,
        any(payout_norm) as resolution
      FROM pm_unified_ledger_v5
      WHERE lower(wallet_address) = lower('${wallet}')
      GROUP BY condition_id, outcome_index
    )
    SELECT
      -- V19A: All sources
      sum(CASE WHEN resolution IS NOT NULL
        THEN usdc_all + tokens * resolution
        ELSE usdc_all + tokens * 0.5 END) as v19a_pnl,
      -- V19B: CLOB + PayoutRedemption only (exclude PositionSplit)
      sum(CASE WHEN resolution IS NOT NULL
        THEN usdc_clob_payout + tokens * resolution
        ELSE usdc_clob_payout + tokens * 0.5 END) as v19b_pnl,
      -- V19C: CLOB only (like V18 but from unified ledger)
      sum(CASE WHEN resolution IS NOT NULL
        THEN usdc_clob + tokens * resolution
        ELSE usdc_clob + tokens * 0.5 END) as v19c_pnl
    FROM positions
  `;

  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  const variants = rows2[0] || { v19a_pnl: 0, v19b_pnl: 0, v19c_pnl: 0 };

  return {
    wallet,
    username,
    uiPnl,
    v18Pnl,
    errorPct,
    sources: rows1,
    v19a: Number(variants.v19a_pnl),
    v19b: Number(variants.v19b_pnl),
    v19c: Number(variants.v19c_pnl),
  };
}

async function main() {
  console.log('='.repeat(120));
  console.log('BENCHMARK WALLETS SOURCE TYPE ANALYSIS');
  console.log('='.repeat(120));

  // Load benchmark data
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const benchmarks: Map<string, BenchmarkResult> = new Map();
  for (const r of report.results) {
    benchmarks.set(r.wallet.toLowerCase(), r);
  }

  console.log(`\nAnalyzing ${benchmarks.size} wallets...\n`);

  // Results table
  console.log(
    'Username       | UI PnL      | V18         | V18 Err% | V19A        | V19A Err% | V19B        | V19B Err% | Sources'
  );
  console.log('-'.repeat(120));

  const results: any[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const result = await analyzeWallet(wallet, benchmark);
    results.push(result);

    const sourceList = result.sources.map((s: any) => s.source_type).join(',');
    const v19aErr = result.uiPnl !== 0 ? Math.abs(result.v19a - result.uiPnl) / Math.abs(result.uiPnl) * 100 : 0;
    const v19bErr = result.uiPnl !== 0 ? Math.abs(result.v19b - result.uiPnl) / Math.abs(result.uiPnl) * 100 : 0;

    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `$${result.uiPnl.toFixed(2).padStart(9)} | ` +
        `$${result.v18Pnl.toFixed(2).padStart(9)} | ` +
        `${result.errorPct.toFixed(1).padStart(7)}% | ` +
        `$${result.v19a.toFixed(2).padStart(9)} | ` +
        `${v19aErr.toFixed(1).padStart(8)}% | ` +
        `$${result.v19b.toFixed(2).padStart(9)} | ` +
        `${v19bErr.toFixed(1).padStart(8)}% | ` +
        `${sourceList.substring(0, 25)}`
    );
  }

  // Summary stats
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));

  const v18Errors = results.map((r) => r.errorPct);
  const v19aErrors = results.map((r) =>
    r.uiPnl !== 0 ? Math.abs(r.v19a - r.uiPnl) / Math.abs(r.uiPnl) * 100 : 0
  );
  const v19bErrors = results.map((r) =>
    r.uiPnl !== 0 ? Math.abs(r.v19b - r.uiPnl) / Math.abs(r.uiPnl) * 100 : 0
  );

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) => arr.filter((e) => e <= threshold).length;

  console.log(`\n          | Median Err | Pass ≤1% | Pass ≤5% | Pass ≤10%`);
  console.log('-'.repeat(60));
  console.log(
    `V18       | ${median(v18Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v18Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19A(all) | ${median(v19aErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19aErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19aErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19aErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19B(-Spl)| ${median(v19bErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19bErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19bErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19bErrors, 10).toString().padStart(8)}`
  );

  console.log(`\nTotal wallets: ${results.length}`);

  // Per-source breakdown for worst wallets
  console.log('\n' + '='.repeat(120));
  console.log('DETAILED BREAKDOWN FOR HIGH-ERROR WALLETS');
  console.log('='.repeat(120));

  const worstWallets = results.filter((r) => r.errorPct > 10).sort((a, b) => b.errorPct - a.errorPct);

  for (const w of worstWallets.slice(0, 5)) {
    console.log(`\n--- ${w.username} (${w.wallet.substring(0, 10)}...) ---`);
    console.log(`UI: $${w.uiPnl.toFixed(2)} | V18: $${w.v18Pnl.toFixed(2)} | V18 Err: ${w.errorPct.toFixed(1)}%`);
    console.log(`V19A: $${w.v19a.toFixed(2)} | V19B: $${w.v19b.toFixed(2)}`);
    console.log('\nSource breakdown:');
    for (const s of w.sources) {
      console.log(`  ${s.source_type.padEnd(20)}: $${Number(s.sum_usdc).toFixed(2).padStart(10)} USDC, ${Number(s.sum_tokens).toFixed(2).padStart(10)} tokens`);
    }
  }
}

main().catch(console.error);
