/**
 * Test NegRisk-Aware Engine against validation cohort
 *
 * Compares the new netting formula to API baseline
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { calculateWalletPnL } from '../lib/pnl/pnlEngineNegRiskAware';

async function main() {
  console.log('=== Testing NegRisk-Aware PnL Engine ===\n');

  // Get validation wallets with API baseline
  const baselineQuery = `
    SELECT
      b.wallet,
      b.api_pnl,
      v.cohort_type,
      v.trade_count,
      v.maker_ratio
    FROM pm_pnl_baseline_api_v2 b
    JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
    ORDER BY rand()
    LIMIT 50
  `;

  console.log('Fetching 50 random validation wallets...');
  const baselineResult = await clickhouse.query({ query: baselineQuery, format: 'JSONEachRow' });
  const wallets = await baselineResult.json() as any[];
  console.log(`Got ${wallets.length} wallets\n`);

  const results: Array<{
    wallet: string;
    cohort_type: string;
    api_pnl: number;
    calc_pnl: number;
    error: number;
    abs_error: number;
    trade_count: number;
    conditions: number;
  }> = [];

  // Calculate PnL for each wallet
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`\rProcessing ${i + 1}/${wallets.length}: ${w.wallet.slice(0, 10)}...`);

    try {
      const result = await calculateWalletPnL(w.wallet);
      const error = result.total_pnl - Number(w.api_pnl);

      results.push({
        wallet: w.wallet,
        cohort_type: w.cohort_type,
        api_pnl: Number(w.api_pnl),
        calc_pnl: result.total_pnl,
        error,
        abs_error: Math.abs(error),
        trade_count: Number(w.trade_count),
        conditions: result.conditions.length,
      });
    } catch (e: any) {
      console.error(`\nError processing ${w.wallet}: ${e.message}`);
    }
  }

  console.log('\n\n=== Results Summary ===\n');

  // Sort by absolute error
  results.sort((a, b) => a.abs_error - b.abs_error);

  // Calculate metrics
  const within100 = results.filter(r => r.abs_error <= 100);
  const within500 = results.filter(r => r.abs_error <= 500);
  const within1000 = results.filter(r => r.abs_error <= 1000);

  const avgError = results.reduce((s, r) => s + r.error, 0) / results.length;
  const avgAbsError = results.reduce((s, r) => s + r.abs_error, 0) / results.length;
  const medianError = results[Math.floor(results.length / 2)]?.error || 0;

  console.log(`Total wallets tested: ${results.length}`);
  console.log(`Within $100 error: ${within100.length} (${(within100.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $500 error: ${within500.length} (${(within500.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $1000 error: ${within1000.length} (${(within1000.length / results.length * 100).toFixed(1)}%)`);
  console.log(`\nAverage error: $${avgError.toFixed(2)}`);
  console.log(`Average absolute error: $${avgAbsError.toFixed(2)}`);
  console.log(`Median error: $${medianError.toFixed(2)}`);

  // Best matches
  console.log('\n=== Top 10 Best Matches ===\n');
  console.log('Wallet                                     | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(90));

  for (const r of results.slice(0, 10)) {
    console.log(
      `${r.wallet} | ` +
      `$${r.api_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.calc_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.error.toFixed(2)}`
    );
  }

  // Worst matches
  console.log('\n=== Top 10 Worst Matches ===\n');
  console.log('Wallet                                     | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(90));

  const worst = results.slice(-10).reverse();
  for (const r of worst) {
    console.log(
      `${r.wallet} | ` +
      `$${r.api_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.calc_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.error.toFixed(2)}`
    );
  }

  // Analyze by cohort
  console.log('\n=== Results by Cohort ===\n');

  const byCohort = new Map<string, typeof results>();
  for (const r of results) {
    const list = byCohort.get(r.cohort_type) || [];
    list.push(r);
    byCohort.set(r.cohort_type, list);
  }

  console.log('Cohort Type      | Count | Avg Error     | Within $100 | Within $1000');
  console.log('-'.repeat(75));

  for (const [cohort, items] of byCohort) {
    const avgErr = items.reduce((s, r) => s + r.error, 0) / items.length;
    const w100 = items.filter(r => r.abs_error <= 100).length;
    const w1000 = items.filter(r => r.abs_error <= 1000).length;

    console.log(
      `${cohort.padEnd(16)} | ${String(items.length).padStart(5)} | ` +
      `$${avgErr.toFixed(2).padStart(11)} | ` +
      `${String(w100).padStart(11)} | ` +
      `${String(w1000).padStart(12)}`
    );
  }

  console.log('\n✅ Test complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
