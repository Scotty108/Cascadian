import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

async function main() {
  // Load high-coverage wallets
  const wallets = JSON.parse(fs.readFileSync('tmp/ui_wallets_trader_strict_v2_highcov.json', 'utf8'));
  console.log(`Validating ${wallets.length} high-coverage wallets (>=95% resolution coverage)`);
  console.log('');

  // Load UI benchmarks for these wallets
  const benchmarkSet = 'trader_strict_v2_2025_12_07';
  const benchmarkQuery = `
    SELECT
      lower(wallet_address) as wallet,
      ui_pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v2
    WHERE benchmark_set = '${benchmarkSet}'
      AND status = 'success'
      AND lower(wallet_address) IN (${wallets.map((w: string) => `'${w.toLowerCase()}'`).join(',')})
  `;

  const benchResult = await clickhouse.query({ query: benchmarkQuery, format: 'JSONEachRow' });
  const benchRows = await benchResult.json() as any[];

  const uiPnlMap = new Map<string, number>();
  for (const row of benchRows) {
    uiPnlMap.set(row.wallet.toLowerCase(), Number(row.ui_pnl || 0));
  }

  console.log(`Loaded ${uiPnlMap.size} UI benchmarks`);
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i].toLowerCase();
    const uiPnl = uiPnlMap.get(wallet);

    if (uiPnl === undefined) {
      console.log(`  [${i + 1}/${wallets.length}] ${wallet.slice(0,8)}... - NO UI BENCHMARK`);
      continue;
    }

    try {
      const v29Result = await calculateV29PnL(wallet);
      const v29Total = (v29Result?.realizedPnl || 0) + (v29Result?.unrealizedPnl || 0);
      const v29Realized = v29Result?.realizedPnl || 0;
      const v29Unrealized = v29Result?.unrealizedPnl || 0;

      const absError = Math.abs(v29Total - uiPnl);
      const pctError = uiPnl !== 0 ? (absError / Math.abs(uiPnl)) * 100 : null;

      results.push({
        wallet,
        ui_pnl: uiPnl,
        v29_total: v29Total,
        v29_realized: v29Realized,
        v29_unrealized: v29Unrealized,
        abs_error: absError,
        pct_error: pctError
      });

      const status = pctError !== null && pctError < 6 ? '✅' : '❌';
      console.log(`  [${i + 1}/${wallets.length}] ${wallet.slice(0,8)}... UI=$${uiPnl.toFixed(0)} V29=$${v29Total.toFixed(0)} Err=${pctError?.toFixed(1) || '-'}% ${status}`);
    } catch (err: any) {
      console.log(`  [${i + 1}/${wallets.length}] ${wallet.slice(0,8)}... ERROR: ${err.message}`);
    }
  }

  // Summary statistics
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('V29 TOTAL vs UI PnL VALIDATION (High-Coverage Subset)');
  console.log('Benchmark Set:', benchmarkSet);
  console.log('Resolution Coverage Filter: >=95%');
  console.log('Tolerance: 6%');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  const testable = results.filter(r => Math.abs(r.ui_pnl) > 100);
  const passing = testable.filter(r => r.pct_error !== null && r.pct_error < 6);
  const failing = testable.filter(r => r.pct_error === null || r.pct_error >= 6);

  console.log(`Total Wallets: ${results.length}`);
  console.log(`Testable (|UI| > $100): ${testable.length}`);
  console.log(`Pass Rate (< 6%): ${passing.length}/${testable.length} (${testable.length ? ((passing.length / testable.length) * 100).toFixed(1) : 0}%)`);
  console.log(`Fail Rate (>= 6%): ${failing.length}/${testable.length} (${testable.length ? ((failing.length / testable.length) * 100).toFixed(1) : 0}%)`);
  console.log('');

  // Sort by pct_error descending for worst offenders
  const sorted = [...testable].sort((a, b) => (b.pct_error || 0) - (a.pct_error || 0));

  console.log('Top 10 Worst Offenders:');
  console.log('| Wallet | UI PnL | V29 Total | V29 Realized | V29 Unrealized | Abs Error | % Error |');
  console.log('|--------|--------|-----------|--------------|----------------|-----------|---------|');
  for (const r of sorted.slice(0, 10)) {
    console.log(`| ${r.wallet.slice(0,6)}...${r.wallet.slice(-4)} | $${r.ui_pnl.toFixed(0)} | $${r.v29_total.toFixed(0)} | $${r.v29_realized.toFixed(0)} | $${r.v29_unrealized.toFixed(0)} | $${r.abs_error.toFixed(0)} | ${r.pct_error?.toFixed(1) || '-'}% |`);
  }

  console.log('');
  console.log('Passing Wallets (< 6% error):');
  console.log('| Wallet | UI PnL | V29 Total | % Error |');
  console.log('|--------|--------|-----------|---------|');
  for (const r of passing) {
    console.log(`| ${r.wallet.slice(0,6)}...${r.wallet.slice(-4)} | $${r.ui_pnl.toFixed(0)} | $${r.v29_total.toFixed(0)} | ${r.pct_error?.toFixed(1) || '-'}% |`);
  }

  // Save results
  fs.writeFileSync('tmp/v29_vs_ui_highcov_validation_2025_12_07.json', JSON.stringify(results, null, 2));
  console.log('');
  console.log('Saved results to tmp/v29_vs_ui_highcov_validation_2025_12_07.json');
}

main().catch(console.error);
