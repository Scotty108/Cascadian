/**
 * Test V17 Engine Against All 8 Wallets
 *
 * Compares V17 PnL against:
 * - pm_cascadian_pnl_v1_new (the source of truth we're aligning to)
 * - UI reported PnL (the ultimate target)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const TEST_WALLETS = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2120c0099214e372dbba5e9', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

interface CascadianSummary {
  wallet: string;
  total_realized_pnl: number;
  positions_count: number;
}

async function loadCascadianSummary(wallet: string): Promise<CascadianSummary | null> {
  const query = `
    SELECT
      trader_wallet as wallet,
      sum(realized_pnl) as total_realized_pnl,
      count() as positions_count
    FROM pm_cascadian_pnl_v1_new
    WHERE lower(trader_wallet) = lower('${wallet}')
    GROUP BY trader_wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) return null;

  return {
    wallet: rows[0].wallet,
    total_realized_pnl: Number(rows[0].total_realized_pnl),
    positions_count: Number(rows[0].positions_count),
  };
}

async function main() {
  console.log('='.repeat(140));
  console.log('V17 ENGINE VALIDATION - ALL 8 WALLETS');
  console.log('='.repeat(140));
  console.log('');

  const engine = createV17Engine();
  const results: {
    name: string;
    wallet: string;
    ui_pnl: number;
    cascadian_pnl: number | null;
    v17_pnl: number;
    v17_vs_cascadian_error: number | null;
    v17_vs_ui_error: number;
  }[] = [];

  for (const w of TEST_WALLETS) {
    console.log(`Processing ${w.name}...`);
    const startTime = Date.now();

    // Load cascadian data
    const cascadian = await loadCascadianSummary(w.wallet);

    // Run V17 engine
    const v17Result = await engine.compute(w.wallet);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const v17_vs_cascadian_error =
      cascadian && cascadian.total_realized_pnl !== 0
        ? ((v17Result.realized_pnl - cascadian.total_realized_pnl) / Math.abs(cascadian.total_realized_pnl)) * 100
        : null;

    const v17_vs_ui_error = ((v17Result.realized_pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;

    results.push({
      name: w.name,
      wallet: w.wallet,
      ui_pnl: w.ui_pnl,
      cascadian_pnl: cascadian?.total_realized_pnl ?? null,
      v17_pnl: v17Result.realized_pnl,
      v17_vs_cascadian_error,
      v17_vs_ui_error,
    });

    console.log(`  Done in ${elapsed}s`);
  }

  // Print results table
  console.log('');
  console.log('='.repeat(140));
  console.log('RESULTS');
  console.log('='.repeat(140));
  console.log(
    'Wallet           | UI PnL           | Cascadian PnL    | V17 PnL          | V17 vs Cascadian | V17 vs UI'
  );
  console.log('-'.repeat(140));

  for (const r of results) {
    const cascadianStr = r.cascadian_pnl !== null ? `$${r.cascadian_pnl.toLocaleString()}`.padStart(14) : 'N/A'.padStart(14);
    const cascadianErrStr =
      r.v17_vs_cascadian_error !== null ? `${r.v17_vs_cascadian_error.toFixed(1)}%`.padStart(15) : 'N/A'.padStart(15);

    console.log(
      `${r.name.substring(0, 16).padEnd(16)} | $${r.ui_pnl.toLocaleString().padStart(14)} | ${cascadianStr} | $${r.v17_pnl.toLocaleString().padStart(14)} | ${cascadianErrStr} | ${r.v17_vs_ui_error.toFixed(1).padStart(8)}%`
    );
  }

  // Summary stats
  console.log('');
  console.log('='.repeat(140));
  console.log('SUMMARY');
  console.log('='.repeat(140));

  // Count passes (V17 vs Cascadian < 1%)
  const cascadianPasses = results.filter((r) => r.v17_vs_cascadian_error !== null && Math.abs(r.v17_vs_cascadian_error) < 1);
  console.log(`V17 vs Cascadian match (<1% error): ${cascadianPasses.length}/${results.length}`);

  // Count UI passes (<25% error and sign match)
  const uiPasses = results.filter((r) => {
    const signMatch = (r.v17_pnl >= 0) === (r.ui_pnl >= 0);
    return Math.abs(r.v17_vs_ui_error) < 25 && signMatch;
  });
  console.log(`V17 vs UI match (<25% error, same sign): ${uiPasses.length}/${results.length}`);

  // Average error stats
  const avgCascadianError =
    results
      .filter((r) => r.v17_vs_cascadian_error !== null)
      .reduce((s, r) => s + Math.abs(r.v17_vs_cascadian_error!), 0) /
    results.filter((r) => r.v17_vs_cascadian_error !== null).length;

  const avgUIError = results.reduce((s, r) => s + Math.abs(r.v17_vs_ui_error), 0) / results.length;

  console.log(`Average |V17 vs Cascadian| error: ${avgCascadianError.toFixed(1)}%`);
  console.log(`Average |V17 vs UI| error: ${avgUIError.toFixed(1)}%`);

  console.log('');
  console.log('='.repeat(140));
  console.log('TEST COMPLETE');
  console.log('='.repeat(140));
}

main().catch(console.error);
