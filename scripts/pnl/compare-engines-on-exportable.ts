/**
 * Compare PnL Engines on Exportable Wallets
 *
 * Reads /tmp/wallet_quality_exportable_realized.csv
 * Runs V13, V17, V19, V20 engines on each wallet
 * Outputs median and p95 absolute percent error for each engine
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import { calculateWalletPnlV13 } from '../../lib/pnl/uiPnlEngineV13';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

// Initialize V17 engine once
const v17Engine = createV17Engine();

interface EngineResult {
  wallet: string;
  ui_pnl: number;
  v13_pnl: number | null;
  v17_pnl: number | null;
  v19_pnl: number | null;
  v20_pnl: number | null;
  v13_delta_pct: number | null;
  v17_delta_pct: number | null;
  v19_delta_pct: number | null;
  v20_delta_pct: number | null;
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
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ENGINE COMPARISON ON EXPORTABLE WALLETS                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Read exportable wallets
  const csvPath = '/tmp/wallet_quality_exportable_realized.csv';
  if (!fs.existsSync(csvPath)) {
    console.error('ERROR: Run audit-wallet-input-quality.ts first');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');
  const walletIdx = header.indexOf('wallet');
  const uiPnlIdx = header.indexOf('ui_pnl');

  const wallets: Array<{ wallet: string; ui_pnl: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    wallets.push({
      wallet: cols[walletIdx],
      ui_pnl: parseFloat(cols[uiPnlIdx]),
    });
  }

  console.log(`Found ${wallets.length} exportable wallets\n`);

  const results: EngineResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const { wallet, ui_pnl } = wallets[i];
    console.log(`[${i + 1}/${wallets.length}] ${wallet.slice(0, 12)}... (UI: $${ui_pnl.toLocaleString()})`);

    const result: EngineResult = {
      wallet,
      ui_pnl,
      v13_pnl: null,
      v17_pnl: null,
      v19_pnl: null,
      v20_pnl: null,
      v13_delta_pct: null,
      v17_delta_pct: null,
      v19_delta_pct: null,
      v20_delta_pct: null,
    };

    try {
      // V13
      const v13 = await calculateWalletPnlV13(wallet);
      result.v13_pnl = v13.total_pnl;
      result.v13_delta_pct = ui_pnl !== 0 ? ((v13.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : null;
    } catch (e: any) {
      console.log(`   V13 error: ${e.message.slice(0, 50)}`);
    }

    try {
      // V17
      const v17 = await v17Engine.compute(wallet);
      result.v17_pnl = v17.total_pnl;
      result.v17_delta_pct = ui_pnl !== 0 ? ((v17.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : null;
    } catch (e: any) {
      console.log(`   V17 error: ${e.message.slice(0, 50)}`);
    }

    try {
      // V19
      const v19 = await calculateV19PnL(wallet);
      result.v19_pnl = v19.total_pnl;
      result.v19_delta_pct = ui_pnl !== 0 ? ((v19.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : null;
    } catch (e: any) {
      console.log(`   V19 error: ${e.message.slice(0, 50)}`);
    }

    try {
      // V20
      const v20 = await calculateV20PnL(wallet);
      result.v20_pnl = v20.total_pnl;
      result.v20_delta_pct = ui_pnl !== 0 ? ((v20.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : null;
    } catch (e: any) {
      console.log(`   V20 error: ${e.message.slice(0, 50)}`);
    }

    const deltas = [
      result.v13_delta_pct !== null ? `V13:${result.v13_delta_pct.toFixed(1)}%` : 'V13:ERR',
      result.v17_delta_pct !== null ? `V17:${result.v17_delta_pct.toFixed(1)}%` : 'V17:ERR',
      result.v19_delta_pct !== null ? `V19:${result.v19_delta_pct.toFixed(1)}%` : 'V19:ERR',
      result.v20_delta_pct !== null ? `V20:${result.v20_delta_pct.toFixed(1)}%` : 'V20:ERR',
    ];
    console.log(`   Deltas: ${deltas.join(' | ')}`);

    results.push(result);
  }

  // Calculate statistics for each engine
  console.log('\n' + '═'.repeat(100));
  console.log('ENGINE COMPARISON RESULTS');
  console.log('═'.repeat(100));

  const engines = ['v13', 'v17', 'v19', 'v20'] as const;
  const stats: Record<string, { median: number; p95: number; count: number; absDeltas: number[] }> = {};

  for (const engine of engines) {
    const deltas = results
      .map(r => r[`${engine}_delta_pct`])
      .filter((d): d is number => d !== null);
    const absDeltas = deltas.map(d => Math.abs(d));

    stats[engine] = {
      median: absDeltas.length > 0 ? median(absDeltas) : Infinity,
      p95: absDeltas.length > 0 ? percentile(absDeltas, 95) : Infinity,
      count: absDeltas.length,
      absDeltas,
    };
  }

  console.log('\nEngine Stats (Absolute % Error vs UI PnL):');
  console.log('─'.repeat(60));
  console.log('Engine | Median | P95    | Count | Best?');
  console.log('─'.repeat(60));

  let bestEngine = '';
  let bestMedian = Infinity;
  for (const engine of engines) {
    const s = stats[engine];
    const isBest = s.median < bestMedian;
    if (isBest) {
      bestMedian = s.median;
      bestEngine = engine;
    }
    console.log(
      `${engine.toUpperCase().padEnd(6)} | ${s.median.toFixed(1).padStart(6)}% | ${s.p95.toFixed(1).padStart(6)}% | ${String(s.count).padStart(5)} | ${isBest ? '←' : ''}`
    );
  }
  console.log('─'.repeat(60));

  console.log(`\n✓ BEST ENGINE: ${bestEngine.toUpperCase()} (median ${bestMedian.toFixed(1)}% error)`);

  // Detailed per-wallet results
  console.log('\n' + '─'.repeat(100));
  console.log('PER-WALLET RESULTS:');
  console.log('─'.repeat(100));
  console.log('Wallet (short)       | UI PnL        | V13 Δ%   | V17 Δ%   | V19 Δ%   | V20 Δ%');
  console.log('─'.repeat(100));

  for (const r of results) {
    const ui = `$${r.ui_pnl.toLocaleString().padStart(12)}`;
    const v13 = r.v13_delta_pct !== null ? `${r.v13_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    const v17 = r.v17_delta_pct !== null ? `${r.v17_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    const v19 = r.v19_delta_pct !== null ? `${r.v19_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    const v20 = r.v20_delta_pct !== null ? `${r.v20_delta_pct.toFixed(1)}%`.padStart(8) : '  ERR';
    console.log(`${r.wallet.slice(0, 20)} | ${ui} | ${v13} | ${v17} | ${v19} | ${v20}`);
  }

  // Write results CSV
  const csvHeader = 'wallet,ui_pnl,v13_pnl,v17_pnl,v19_pnl,v20_pnl,v13_delta_pct,v17_delta_pct,v19_delta_pct,v20_delta_pct';
  const csvRows = results.map(r => [
    r.wallet,
    r.ui_pnl,
    r.v13_pnl ?? '',
    r.v17_pnl ?? '',
    r.v19_pnl ?? '',
    r.v20_pnl ?? '',
    r.v13_delta_pct?.toFixed(2) ?? '',
    r.v17_delta_pct?.toFixed(2) ?? '',
    r.v19_delta_pct?.toFixed(2) ?? '',
    r.v20_delta_pct?.toFixed(2) ?? '',
  ].join(','));
  fs.writeFileSync('/tmp/engine_comparison_results.csv', [csvHeader, ...csvRows].join('\n'));
  console.log('\nWrote /tmp/engine_comparison_results.csv');

  console.log('\n' + '═'.repeat(100));
  console.log('RECOMMENDATION:');
  console.log('═'.repeat(100));
  if (bestMedian < 5) {
    console.log(`Use ${bestEngine.toUpperCase()} for realized PnL export. Median error ${bestMedian.toFixed(1)}% is acceptable.`);
  } else if (bestMedian < 20) {
    console.log(`${bestEngine.toUpperCase()} is best but ${bestMedian.toFixed(1)}% error needs investigation.`);
    console.log('Check the worst-performing wallets for data issues.');
  } else {
    console.log(`All engines have >20% median error. Fix token map or dedup issues first.`);
  }
}

main().catch(console.error);
