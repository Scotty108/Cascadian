/**
 * ============================================================================
 * Decompose V20 Error for Benchmark Wallets
 * ============================================================================
 *
 * Analyzes why V20 has errors for specific wallets in the benchmark set.
 * For each wallet with error > 5%, this script determines:
 *   1. What percentage is due to unresolved positions (mark-to-market guess)
 *   2. What percentage is due to non-CLOB activity (ERC1155 transfers, AMM)
 *   3. What percentage is due to multi-outcome market complexity
 *
 * Usage:
 *   npx tsx scripts/pnl/decompose-v20-error.ts
 *   npx tsx scripts/pnl/decompose-v20-error.ts --set=fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import * as fs from 'fs';

interface BenchmarkRow {
  wallet: string;
  pnl_value: number;
  benchmark_set: string;
  captured_at: string;
  note: string;
}

interface WalletBreakdown {
  wallet: string;
  ui_pnl: number;
  v20_pnl: number;
  error_pct: number;
  error_amount: number;

  // Position counts
  total_positions: number;
  resolved_positions: number;
  unresolved_positions: number;

  // Source type breakdown
  clob_events: number;
  redemption_events: number;
  transfer_events: number;
  total_events: number;

  // Market complexity
  markets_traded: number;
  multi_outcome_markets: number;

  // Potential error attributions
  unrealized_contribution: number;
  non_clob_usdc: number;
  transfer_only_positions: number;

  // Classification
  error_category: string;
}

const ERROR_THRESHOLD = 5; // 5% error threshold

async function getBenchmarks(benchmarkSet?: string): Promise<BenchmarkRow[]> {
  const setsResult = await clickhouse.query({
    query: `
      SELECT benchmark_set, count() as cnt, max(captured_at) as latest
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY benchmark_set
      ORDER BY latest DESC
    `,
    format: 'JSONEachRow',
  });
  const sets = (await setsResult.json()) as any[];

  if (sets.length === 0) {
    console.log('No benchmark sets found');
    return [];
  }

  const targetSet = benchmarkSet || sets[0].benchmark_set;

  console.log('Available benchmark sets:');
  sets.forEach((s: any) => {
    const marker = s.benchmark_set === targetSet ? ' <-- USING' : '';
    console.log(`  ${s.benchmark_set}: ${s.cnt} wallets (${s.latest})${marker}`);
  });
  console.log('');

  const result = await clickhouse.query({
    query: `
      SELECT wallet, pnl_value, benchmark_set, captured_at, note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = {set:String}
    `,
    query_params: { set: targetSet },
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

async function analyzeWallet(wallet: string, uiPnl: number): Promise<WalletBreakdown> {
  // Get V20 PnL
  const v20Result = await calculateV20PnL(wallet);

  // Get detailed position breakdown
  const positionQuery = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price,
        countIf(source_type = 'CLOB') AS clob_events,
        countIf(source_type = 'PayoutRedemption') AS redemption_events,
        countIf(source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_events
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      count() AS total_positions,
      sumIf(1, resolution_price IS NOT NULL) AS resolved_positions,
      sumIf(1, resolution_price IS NULL) AS unresolved_positions,
      sum(clob_events) AS total_clob_events,
      sum(redemption_events) AS total_redemption_events,
      sum(transfer_events) AS total_transfer_events,
      sumIf(1, clob_events = 0 AND transfer_events > 0) AS transfer_only_positions,
      -- Unrealized contribution
      sumIf(cash_flow + final_tokens * 0.5, resolution_price IS NULL) AS unrealized_pnl
    FROM positions
  `;

  const positionResult = await clickhouse.query({ query: positionQuery, format: 'JSONEachRow' });
  const positionRows = (await positionResult.json()) as any[];
  const pos = positionRows[0] || {};

  // Get non-CLOB USDC movements
  const nonClobQuery = `
    SELECT
      sum(usdc_delta) AS non_clob_usdc
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type NOT IN ('CLOB')
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const nonClobResult = await clickhouse.query({ query: nonClobQuery, format: 'JSONEachRow' });
  const nonClobRows = (await nonClobResult.json()) as any[];
  const nonClobUsdc = Number(nonClobRows[0]?.non_clob_usdc || 0);

  // Get multi-outcome market count
  const marketQuery = `
    SELECT
      uniqExact(condition_id) AS markets_traded,
      sumIf(1, outcome_count > 2) AS multi_outcome_markets
    FROM (
      SELECT condition_id, uniqExact(outcome_index) AS outcome_count
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id
    )
  `;

  const marketResult = await clickhouse.query({ query: marketQuery, format: 'JSONEachRow' });
  const marketRows = (await marketResult.json()) as any[];
  const market = marketRows[0] || {};

  const errorPct = calculateError(v20Result.total_pnl, uiPnl);
  const errorAmount = v20Result.total_pnl - uiPnl;

  // Determine error category
  let errorCategory = 'UNKNOWN';
  const unresolvedRatio = Number(pos.unresolved_positions || 0) / Math.max(1, Number(pos.total_positions || 1));
  const nonClobRatio = Math.abs(nonClobUsdc) / Math.max(1, Math.abs(uiPnl));
  const transferOnlyRatio = Number(pos.transfer_only_positions || 0) / Math.max(1, Number(pos.total_positions || 1));

  if (errorPct < ERROR_THRESHOLD) {
    errorCategory = 'PASS';
  } else if (transferOnlyRatio > 0.1) {
    errorCategory = 'TRANSFER_ONLY_POSITIONS';
  } else if (nonClobRatio > 0.2) {
    errorCategory = 'NON_CLOB_ACTIVITY';
  } else if (unresolvedRatio > 0.3) {
    errorCategory = 'UNREALIZED_ESTIMATION';
  } else if (Number(market.multi_outcome_markets || 0) > 5) {
    errorCategory = 'MULTI_OUTCOME_COMPLEXITY';
  } else {
    errorCategory = 'DATA_QUALITY';
  }

  return {
    wallet,
    ui_pnl: uiPnl,
    v20_pnl: v20Result.total_pnl,
    error_pct: errorPct,
    error_amount: errorAmount,
    total_positions: Number(pos.total_positions || 0),
    resolved_positions: Number(pos.resolved_positions || 0),
    unresolved_positions: Number(pos.unresolved_positions || 0),
    clob_events: Number(pos.total_clob_events || 0),
    redemption_events: Number(pos.total_redemption_events || 0),
    transfer_events: Number(pos.total_transfer_events || 0),
    total_events: Number(pos.total_clob_events || 0) + Number(pos.total_redemption_events || 0) + Number(pos.total_transfer_events || 0),
    markets_traded: Number(market.markets_traded || 0),
    multi_outcome_markets: Number(market.multi_outcome_markets || 0),
    unrealized_contribution: Number(pos.unrealized_pnl || 0),
    non_clob_usdc: nonClobUsdc,
    transfer_only_positions: Number(pos.transfer_only_positions || 0),
    error_category: errorCategory,
  };
}

async function main(benchmarkSet?: string): Promise<void> {
  console.log('='.repeat(80));
  console.log('V20 ERROR DECOMPOSITION');
  console.log('='.repeat(80));
  console.log('');

  const benchmarks = await getBenchmarks(benchmarkSet);
  if (benchmarks.length === 0) {
    console.log('ERROR: No benchmarks found.');
    process.exit(1);
  }

  console.log(`Analyzing ${benchmarks.length} wallets...`);
  console.log('');

  const results: WalletBreakdown[] = [];
  let processed = 0;

  for (const bench of benchmarks) {
    try {
      const breakdown = await analyzeWallet(bench.wallet, bench.pnl_value);
      results.push(breakdown);

      processed++;
      if (processed % 5 === 0) {
        process.stdout.write(`\rProcessed ${processed}/${benchmarks.length}...`);
      }
    } catch (e) {
      console.error(`\nError processing ${bench.wallet}:`, e);
    }
  }

  console.log('\r' + ' '.repeat(50));
  console.log('');

  // Summary by error category
  const categoryCounts: Record<string, number> = {};
  const categoryErrors: Record<string, number[]> = {};

  for (const r of results) {
    categoryCounts[r.error_category] = (categoryCounts[r.error_category] || 0) + 1;
    if (!categoryErrors[r.error_category]) categoryErrors[r.error_category] = [];
    categoryErrors[r.error_category].push(r.error_pct);
  }

  console.log('='.repeat(80));
  console.log('ERROR CATEGORY BREAKDOWN');
  console.log('='.repeat(80));
  console.log('');
  console.log('Category'.padEnd(30), 'Count'.padStart(8), 'Avg Error'.padStart(12));
  console.log('-'.repeat(55));

  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    const avgError = categoryErrors[cat].reduce((a, b) => a + b, 0) / count;
    console.log(cat.padEnd(30), String(count).padStart(8), `${avgError.toFixed(1)}%`.padStart(12));
  }
  console.log('');

  // Show failing wallets by category
  const failingWallets = results.filter((r) => r.error_pct >= ERROR_THRESHOLD);

  if (failingWallets.length > 0) {
    console.log('='.repeat(80));
    console.log(`FAILING WALLETS (${failingWallets.length})`);
    console.log('='.repeat(80));
    console.log('');

    // Group by category
    const byCategory: Record<string, WalletBreakdown[]> = {};
    for (const w of failingWallets) {
      if (!byCategory[w.error_category]) byCategory[w.error_category] = [];
      byCategory[w.error_category].push(w);
    }

    for (const [cat, wallets] of Object.entries(byCategory)) {
      console.log(`\n--- ${cat} (${wallets.length} wallets) ---\n`);
      wallets.sort((a, b) => b.error_pct - a.error_pct);

      for (const w of wallets.slice(0, 10)) {
        const walletShort = w.wallet.slice(0, 10) + '...';
        const uiStr = formatPnl(w.ui_pnl);
        const v20Str = formatPnl(w.v20_pnl);
        const errStr = `${w.error_pct.toFixed(1)}%`;
        const posStr = `${w.resolved_positions}/${w.total_positions}`;
        const xferStr = w.transfer_events > 0 ? ` xfer:${w.transfer_events}` : '';
        console.log(`  ${walletShort}  UI:${uiStr.padStart(12)}  V20:${v20Str.padStart(12)}  Err:${errStr.padStart(8)}  Pos:${posStr.padStart(8)}${xferStr}`);
      }
    }
    console.log('');
  }

  // Key insights
  console.log('='.repeat(80));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(80));

  const passCount = results.filter((r) => r.error_pct < ERROR_THRESHOLD).length;
  const passRate = ((passCount / results.length) * 100).toFixed(1);

  console.log(`
1. Overall pass rate: ${passRate}% (${passCount}/${results.length} wallets)

2. Error Attribution Summary:
   - PASS: ${categoryCounts['PASS'] || 0} wallets - V20 is accurate
   - TRANSFER_ONLY_POSITIONS: ${categoryCounts['TRANSFER_ONLY_POSITIONS'] || 0} wallets - missing ERC1155 positions
   - NON_CLOB_ACTIVITY: ${categoryCounts['NON_CLOB_ACTIVITY'] || 0} wallets - significant non-CLOB USDC
   - UNREALIZED_ESTIMATION: ${categoryCounts['UNREALIZED_ESTIMATION'] || 0} wallets - mark-to-market variance
   - MULTI_OUTCOME_COMPLEXITY: ${categoryCounts['MULTI_OUTCOME_COMPLEXITY'] || 0} wallets - complex markets
   - DATA_QUALITY: ${categoryCounts['DATA_QUALITY'] || 0} wallets - ledger data issues

3. RECOMMENDATION:
   - V20 claims ${passRate}% accuracy on this benchmark set
   - Wallets with TRANSFER_ONLY or NON_CLOB issues need additional data sources
   - DATA_QUALITY issues indicate ledger reconciliation problems
`);

  // Save results
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputPath = `/tmp/v20-error-decomposition-${timestamp}.json`;
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        benchmark_set: benchmarks[0]?.benchmark_set,
        summary: {
          total: results.length,
          pass_count: passCount,
          pass_rate: Number(passRate),
          category_counts: categoryCounts,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// Parse command line args
const args = process.argv.slice(2);
let benchmarkSet: string | undefined;
for (const arg of args) {
  if (arg.startsWith('--set=')) {
    benchmarkSet = arg.slice(6);
  }
}

main(benchmarkSet).catch(console.error);
