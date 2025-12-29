/**
 * Test V19 vs V19b against Playwright-scraped UI PnL benchmarks
 *
 * V19 = standard (0.5 mark for unresolved)
 * V19b = synthetic resolution (>=99¢ → resolved as winner, <=1¢ → loser)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import { calculateV19bPnL } from '../../lib/pnl/uiActivityEngineV19b';

interface TestResult {
  wallet: string;
  ui_pnl: number;
  v19_pnl: number | null;
  v19b_pnl: number | null;
  v19_delta_pct: number | null;
  v19b_delta_pct: number | null;
  v19b_better: boolean;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function median(arr: number[]): number {
  return percentile(arr, 50);
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   V19 vs V19b TEST (against Playwright benchmarks)                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Get the most recent Playwright benchmark set
  const benchmarkQuery = `
    SELECT wallet, pnl_value as ui_pnl, captured_at
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = 'hc_playwright_2025_12_13'
    ORDER BY abs(pnl_value) DESC
  `;

  const result = await client.query({ query: benchmarkQuery, format: 'JSONEachRow' });
  const wallets = (await result.json()) as Array<{ wallet: string; ui_pnl: number; captured_at: string }>;

  console.log(`Found ${wallets.length} wallets in hc_playwright_2025_12_13 benchmark set\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const { wallet, ui_pnl } = wallets[i];
    console.log(`[${i + 1}/${wallets.length}] ${wallet.slice(0, 12)}... (UI: $${ui_pnl.toLocaleString()})`);

    const testResult: TestResult = {
      wallet,
      ui_pnl,
      v19_pnl: null,
      v19b_pnl: null,
      v19_delta_pct: null,
      v19b_delta_pct: null,
      v19b_better: false,
    };

    try {
      const v19 = await calculateV19PnL(wallet);
      testResult.v19_pnl = v19.total_pnl;
      testResult.v19_delta_pct = ui_pnl !== 0 ? ((v19.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : 0;
    } catch (e: any) {
      console.log(`   V19 error: ${e.message.slice(0, 50)}`);
    }

    try {
      const v19b = await calculateV19bPnL(wallet);
      testResult.v19b_pnl = v19b.total_pnl;
      testResult.v19b_delta_pct = ui_pnl !== 0 ? ((v19b.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : 0;
    } catch (e: any) {
      console.log(`   V19b error: ${e.message.slice(0, 50)}`);
    }

    // Check if V19b is better (closer to UI)
    if (testResult.v19_delta_pct !== null && testResult.v19b_delta_pct !== null) {
      testResult.v19b_better = Math.abs(testResult.v19b_delta_pct) < Math.abs(testResult.v19_delta_pct);
    }

    const v19Delta = testResult.v19_delta_pct !== null ? `${testResult.v19_delta_pct.toFixed(1)}%` : 'ERR';
    const v19bDelta = testResult.v19b_delta_pct !== null ? `${testResult.v19b_delta_pct.toFixed(1)}%` : 'ERR';
    const winner = testResult.v19b_better ? '← V19b better' : '';
    console.log(`   V19: ${v19Delta.padStart(8)} | V19b: ${v19bDelta.padStart(8)} ${winner}`);

    results.push(testResult);
  }

  // Calculate stats
  console.log('\n' + '═'.repeat(100));
  console.log('COMPARISON RESULTS');
  console.log('═'.repeat(100));

  const v19Deltas = results.filter(r => r.v19_delta_pct !== null).map(r => Math.abs(r.v19_delta_pct!));
  const v19bDeltas = results.filter(r => r.v19b_delta_pct !== null).map(r => Math.abs(r.v19b_delta_pct!));

  console.log('\nEngine Stats (Absolute % Error vs UI PnL):');
  console.log('─'.repeat(60));
  console.log('Engine | Median | P95    | Mean   | Count');
  console.log('─'.repeat(60));

  const v19Median = v19Deltas.length > 0 ? median(v19Deltas) : NaN;
  const v19P95 = v19Deltas.length > 0 ? percentile(v19Deltas, 95) : NaN;
  const v19Mean = v19Deltas.length > 0 ? v19Deltas.reduce((a, b) => a + b, 0) / v19Deltas.length : NaN;

  const v19bMedian = v19bDeltas.length > 0 ? median(v19bDeltas) : NaN;
  const v19bP95 = v19bDeltas.length > 0 ? percentile(v19bDeltas, 95) : NaN;
  const v19bMean = v19bDeltas.length > 0 ? v19bDeltas.reduce((a, b) => a + b, 0) / v19bDeltas.length : NaN;

  console.log(`V19    | ${v19Median.toFixed(1).padStart(6)}% | ${v19P95.toFixed(1).padStart(6)}% | ${v19Mean.toFixed(1).padStart(6)}% | ${v19Deltas.length}`);
  console.log(`V19b   | ${v19bMedian.toFixed(1).padStart(6)}% | ${v19bP95.toFixed(1).padStart(6)}% | ${v19bMean.toFixed(1).padStart(6)}% | ${v19bDeltas.length}`);
  console.log('─'.repeat(60));

  const v19bWins = results.filter(r => r.v19b_better).length;
  const v19Wins = results.filter(r => r.v19_delta_pct !== null && r.v19b_delta_pct !== null && !r.v19b_better).length;

  console.log(`\nHead-to-head: V19b wins ${v19bWins}, V19 wins ${v19Wins}`);

  if (v19bMedian < v19Median) {
    console.log(`\n✓ V19b IS BETTER (${v19bMedian.toFixed(1)}% vs ${v19Median.toFixed(1)}% median error)`);
    console.log('  Synthetic resolution is helping with near-resolved positions.');
  } else {
    console.log(`\n✗ V19 IS STILL BETTER (${v19Median.toFixed(1)}% vs ${v19bMedian.toFixed(1)}% median error)`);
    console.log('  Synthetic resolution did not improve accuracy.');
  }

  // Per-wallet breakdown
  console.log('\n' + '─'.repeat(100));
  console.log('PER-WALLET BREAKDOWN:');
  console.log('─'.repeat(100));
  console.log('Wallet (short)       | UI PnL        | V19 Δ%   | V19b Δ%  | Winner');
  console.log('─'.repeat(100));

  for (const r of results) {
    const ui = `$${r.ui_pnl.toLocaleString().padStart(12)}`;
    const v19 = r.v19_delta_pct !== null ? `${r.v19_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    const v19b = r.v19b_delta_pct !== null ? `${r.v19b_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    const winner = r.v19b_better ? 'V19b' : 'V19';
    console.log(`${r.wallet.slice(0, 20)} | ${ui} | ${v19} | ${v19b} | ${winner}`);
  }
}

main().catch(console.error);
