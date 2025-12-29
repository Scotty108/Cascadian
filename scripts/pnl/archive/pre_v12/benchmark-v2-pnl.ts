/**
 * ============================================================================
 * ⚠️  EXPERIMENTAL - DO NOT USE FOR PRODUCTION
 * ============================================================================
 *
 * This V2 benchmark script is DEPRECATED. Use V20 engine instead:
 *   - Production engine: lib/pnl/uiActivityEngineV20.ts
 *   - Test harness: scripts/pnl/v20-regression-test.ts
 *
 * V2 has known accuracy issues. V20 is the canonical PnL engine for
 * Cascadian v1, validated to within 0.01-2% of Polymarket UI.
 *
 * ============================================================================
 *
 * Original description (for historical reference):
 * Benchmark V2 PnL against UI benchmarks
 * Tests pm_cascadian_pnl_v2 against pm_ui_pnl_benchmarks_v1
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkResult {
  wallet: string;
  ui_pnl: number;
  v2_pnl: number;
  error_pct: number;
  sign_match: boolean;
  category: '<5%' | '<25%' | '<50%' | '>50%' | 'zero_both';
}

async function main() {
  console.log('=== V2 PNL BENCHMARK TEST ===');
  console.log('');

  // Use 50-wallet legacy benchmark (most comprehensive)
  const benchmarkSet = '50_wallet_v1_legacy';

  const setCount = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '${benchmarkSet}'
    `,
    format: 'JSONEachRow'
  });
  const setInfo = { benchmark_set: benchmarkSet, cnt: ((await setCount.json()) as any[])[0]?.cnt };
  console.log(`Using benchmark set: ${setInfo?.benchmark_set} (${setInfo?.cnt} wallets)`);
  console.log('');

  // Get all benchmarks
  const benchmarks = await clickhouse.query({
    query: `
      SELECT
        wallet,
        pnl_value as ui_pnl,
        note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '${setInfo.benchmark_set}'
    `,
    format: 'JSONEachRow'
  });
  const benchRows = await benchmarks.json() as any[];

  // Get V2 PnL for these wallets
  const walletList = benchRows.map((r: any) => `'${r.wallet.toLowerCase()}'`).join(',');
  const v2Pnl = await clickhouse.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        sum(realized_pnl) as v2_pnl
      FROM pm_cascadian_pnl_v2
      WHERE lower(trader_wallet) IN (${walletList})
      GROUP BY lower(trader_wallet)
    `,
    format: 'JSONEachRow'
  });
  const v2Rows = await v2Pnl.json() as any[];
  const v2Map = new Map(v2Rows.map((r: any) => [r.wallet.toLowerCase(), Number(r.v2_pnl)]));

  // Compute results
  const results: BenchmarkResult[] = [];

  for (const bench of benchRows) {
    const uiPnl = Number(bench.ui_pnl);
    const v2 = v2Map.get(bench.wallet.toLowerCase()) || 0;

    let errorPct: number;
    let category: BenchmarkResult['category'];

    if (Math.abs(uiPnl) < 0.01 && Math.abs(v2) < 0.01) {
      errorPct = 0;
      category = 'zero_both';
    } else if (Math.abs(uiPnl) < 0.01) {
      errorPct = 100; // Can't compute % error with zero denominator
      category = '>50%';
    } else {
      errorPct = Math.abs((v2 - uiPnl) / uiPnl) * 100;
      if (errorPct < 5) category = '<5%';
      else if (errorPct < 25) category = '<25%';
      else if (errorPct < 50) category = '<50%';
      else category = '>50%';
    }

    const signMatch = (uiPnl >= 0) === (v2 >= 0);

    results.push({
      wallet: bench.wallet,
      ui_pnl: uiPnl,
      v2_pnl: v2,
      error_pct: errorPct,
      sign_match: signMatch,
      category
    });
  }

  // Sort by error (highest first)
  results.sort((a, b) => b.error_pct - a.error_pct);

  // Print individual results
  console.log('=== INDIVIDUAL RESULTS (sorted by error, worst first) ===');
  console.log('');
  for (const r of results) {
    const sign = r.sign_match ? '✓' : '✗';
    const uiFmt = r.ui_pnl >= 0 ? `$${r.ui_pnl.toFixed(2)}` : `-$${Math.abs(r.ui_pnl).toFixed(2)}`;
    const v2Fmt = r.v2_pnl >= 0 ? `$${r.v2_pnl.toFixed(2)}` : `-$${Math.abs(r.v2_pnl).toFixed(2)}`;
    console.log(`${r.wallet.slice(0,10)}... | UI: ${uiFmt.padStart(14)} | V2: ${v2Fmt.padStart(14)} | Err: ${r.error_pct.toFixed(1).padStart(6)}% | Sign: ${sign} | ${r.category}`);
  }

  // Summary stats
  console.log('');
  console.log('=== SUMMARY ===');
  const total = results.length;
  const signMatches = results.filter(r => r.sign_match).length;
  const under5 = results.filter(r => r.category === '<5%' || r.category === 'zero_both').length;
  const under25 = results.filter(r => r.category === '<5%' || r.category === '<25%' || r.category === 'zero_both').length;
  const under50 = results.filter(r => r.category === '<5%' || r.category === '<25%' || r.category === '<50%' || r.category === 'zero_both').length;
  const over50 = results.filter(r => r.category === '>50%').length;

  console.log(`Total wallets:      ${total}`);
  console.log(`Sign matches:       ${signMatches}/${total} (${(signMatches/total*100).toFixed(1)}%)`);
  console.log(`Error < 5%:         ${under5}/${total} (${(under5/total*100).toFixed(1)}%)`);
  console.log(`Error < 25%:        ${under25}/${total} (${(under25/total*100).toFixed(1)}%)`);
  console.log(`Error < 50%:        ${under50}/${total} (${(under50/total*100).toFixed(1)}%)`);
  console.log(`Error > 50%:        ${over50}/${total} (${(over50/total*100).toFixed(1)}%)`);

  // Compare to V1 baseline if available
  console.log('');
  console.log('=== COMPARISON TO V1 BASELINE ===');
  console.log('Previous V1 results: 95.3% sign match, 46.5% under 50% error');
  console.log(`V2 results:          ${(signMatches/total*100).toFixed(1)}% sign match, ${(under50/total*100).toFixed(1)}% under 50% error`);
}

main().catch(console.error);
