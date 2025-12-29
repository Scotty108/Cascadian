/**
 * Multi-Wallet Engine Comparison
 * Tests V13, V17, V19, V20 against UI benchmarks for all wallets
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
  captured_at: string;
}

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

async function loadBenchmarkWallets(): Promise<BenchmarkWallet[]> {
  const client = getClickHouseClient();

  // Get latest benchmark for each wallet
  const query = `
    SELECT
      wallet,
      pnl_value as ui_pnl,
      captured_at
    FROM pm_ui_pnl_benchmarks_v1
    WHERE (wallet, captured_at) IN (
      SELECT wallet, max(captured_at)
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY wallet
    )
    ORDER BY abs(pnl_value) DESC
    LIMIT 50
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  return await result.json() as BenchmarkWallet[];
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   MULTI-WALLET ENGINE COMPARISON (V13 vs V17 vs V19 vs V20)               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load benchmark wallets
  console.log('Loading benchmark wallets...');
  const wallets = await loadBenchmarkWallets();
  console.log(`Found ${wallets.length} wallets with UI benchmarks\n`);

  // Create engine instances
  const v13Engine = createV13Engine();
  const v17Engine = createV17Engine();

  const results: EngineResult[] = [];

  // Aggregate stats
  const stats = {
    v13: { totalDelta: 0, count: 0, within10pct: 0, within20pct: 0 },
    v17: { totalDelta: 0, count: 0, within10pct: 0, within20pct: 0 },
    v19: { totalDelta: 0, count: 0, within10pct: 0, within20pct: 0 },
    v20: { totalDelta: 0, count: 0, within10pct: 0, within20pct: 0 },
  };

  console.log('Testing engines on each wallet...\n');
  console.log('Wallet                                      | UI PnL      | V13 Δ%   | V17 Δ%   | V19 Δ%   | V20 Δ%');
  console.log('─'.repeat(105));

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const row: EngineResult = {
      wallet: w.wallet,
      ui_pnl: w.ui_pnl,
      v13_pnl: null,
      v17_pnl: null,
      v19_pnl: null,
      v20_pnl: null,
      v13_delta_pct: null,
      v17_delta_pct: null,
      v19_delta_pct: null,
      v20_delta_pct: null,
    };

    // Skip wallets with ~0 UI PnL (can't calculate meaningful delta %)
    if (Math.abs(w.ui_pnl) < 1) {
      console.log(`${w.wallet} | ${w.ui_pnl.toFixed(2).padStart(10)} | SKIP (UI ~0)`);
      continue;
    }

    // Test each engine
    try {
      const v13Result = await v13Engine.compute(w.wallet);
      row.v13_pnl = v13Result?.total_pnl ?? 0;
      row.v13_delta_pct = ((row.v13_pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      stats.v13.totalDelta += Math.abs(row.v13_delta_pct);
      stats.v13.count++;
      if (Math.abs(row.v13_delta_pct) <= 10) stats.v13.within10pct++;
      if (Math.abs(row.v13_delta_pct) <= 20) stats.v13.within20pct++;
    } catch (e) {
      row.v13_pnl = null;
    }

    try {
      const v17Result = await v17Engine.compute(w.wallet);
      row.v17_pnl = v17Result?.total_pnl ?? 0;
      row.v17_delta_pct = ((row.v17_pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      stats.v17.totalDelta += Math.abs(row.v17_delta_pct);
      stats.v17.count++;
      if (Math.abs(row.v17_delta_pct) <= 10) stats.v17.within10pct++;
      if (Math.abs(row.v17_delta_pct) <= 20) stats.v17.within20pct++;
    } catch (e) {
      row.v17_pnl = null;
    }

    try {
      const v19Result = await calculateV19PnL(w.wallet);
      row.v19_pnl = v19Result?.total_pnl ?? 0;
      row.v19_delta_pct = ((row.v19_pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      stats.v19.totalDelta += Math.abs(row.v19_delta_pct);
      stats.v19.count++;
      if (Math.abs(row.v19_delta_pct) <= 10) stats.v19.within10pct++;
      if (Math.abs(row.v19_delta_pct) <= 20) stats.v19.within20pct++;
    } catch (e) {
      row.v19_pnl = null;
    }

    try {
      const v20Result = await calculateV20PnL(w.wallet);
      row.v20_pnl = v20Result?.total_pnl ?? 0;
      row.v20_delta_pct = ((row.v20_pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      stats.v20.totalDelta += Math.abs(row.v20_delta_pct);
      stats.v20.count++;
      if (Math.abs(row.v20_delta_pct) <= 10) stats.v20.within10pct++;
      if (Math.abs(row.v20_delta_pct) <= 20) stats.v20.within20pct++;
    } catch (e) {
      row.v20_pnl = null;
    }

    results.push(row);

    // Print row
    const fmtDelta = (d: number | null) => {
      if (d === null) return 'ERR'.padStart(8);
      const sign = d >= 0 ? '+' : '';
      return (sign + d.toFixed(1) + '%').padStart(8);
    };

    console.log(
      `${w.wallet} | $${w.ui_pnl.toFixed(2).padStart(9)} | ${fmtDelta(row.v13_delta_pct)} | ${fmtDelta(row.v17_delta_pct)} | ${fmtDelta(row.v19_delta_pct)} | ${fmtDelta(row.v20_delta_pct)}`
    );
  }

  console.log('\n' + '═'.repeat(105));
  console.log('AGGREGATE STATISTICS:');
  console.log('═'.repeat(105));
  console.log('Engine | Avg Abs Delta | Within 10% | Within 20% | Wallets Tested');
  console.log('─'.repeat(70));

  const printStats = (name: string, s: typeof stats.v13) => {
    const avgDelta = s.count > 0 ? (s.totalDelta / s.count).toFixed(1) + '%' : 'N/A';
    const pct10 = s.count > 0 ? ((s.within10pct / s.count) * 100).toFixed(0) + '%' : 'N/A';
    const pct20 = s.count > 0 ? ((s.within20pct / s.count) * 100).toFixed(0) + '%' : 'N/A';
    console.log(`${name.padEnd(6)} | ${avgDelta.padStart(13)} | ${pct10.padStart(10)} | ${pct20.padStart(10)} | ${s.count}`);
  };

  printStats('V13', stats.v13);
  printStats('V17', stats.v17);
  printStats('V19', stats.v19);
  printStats('V20', stats.v20);

  // Determine winner
  const engines = [
    { name: 'V13', avg: stats.v13.count > 0 ? stats.v13.totalDelta / stats.v13.count : Infinity },
    { name: 'V17', avg: stats.v17.count > 0 ? stats.v17.totalDelta / stats.v17.count : Infinity },
    { name: 'V19', avg: stats.v19.count > 0 ? stats.v19.totalDelta / stats.v19.count : Infinity },
    { name: 'V20', avg: stats.v20.count > 0 ? stats.v20.totalDelta / stats.v20.count : Infinity },
  ].sort((a, b) => a.avg - b.avg);

  console.log('\n🏆 WINNER: ' + engines[0].name + ' with average absolute delta of ' + engines[0].avg.toFixed(1) + '%');
  console.log('   Runner-up: ' + engines[1].name + ' with ' + engines[1].avg.toFixed(1) + '%');
}

main().catch(console.error);
