/**
 * Test NegRisk V2 Engine against validation wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { getWalletPnLNegRiskV2 } from '../lib/pnl/pnlEngineNegRiskV2';

interface ValidationWallet {
  wallet: string;
  api_pnl: number;
  cohort_type: string;
}

async function main() {
  console.log('=== Testing NegRisk V2 PnL Engine ===\n');

  // Get validation wallets with baseline
  const query = `
    SELECT
      b.wallet,
      b.api_pnl,
      v.cohort_type
    FROM pm_pnl_baseline_api_v2 b
    JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
    ORDER BY rand()
    LIMIT 30
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as ValidationWallet[];
  console.log(`Testing ${wallets.length} wallets\n`);

  const results: Array<{
    wallet: string;
    cohort: string;
    api_pnl: number;
    calc_pnl: number;
    error: number;
    abs_error: number;
  }> = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`\rProcessing ${i + 1}/${wallets.length}: ${w.wallet.slice(0, 10)}...`);

    try {
      const pnl = await getWalletPnLNegRiskV2(w.wallet);
      const error = pnl.realized_pnl - Number(w.api_pnl);
      results.push({
        wallet: w.wallet,
        cohort: w.cohort_type,
        api_pnl: Number(w.api_pnl),
        calc_pnl: pnl.realized_pnl,
        error,
        abs_error: Math.abs(error),
      });
    } catch (err: any) {
      console.error(`\nError processing ${w.wallet}: ${err.message}`);
    }
  }

  console.log('\n\n=== Results Summary ===\n');

  const within100 = results.filter(r => r.abs_error <= 100).length;
  const within500 = results.filter(r => r.abs_error <= 500).length;
  const within1000 = results.filter(r => r.abs_error <= 1000).length;

  console.log(`Total wallets tested: ${results.length}`);
  console.log(`Within $100 error: ${within100} (${(within100 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $500 error: ${within500} (${(within500 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $1000 error: ${within1000} (${(within1000 / results.length * 100).toFixed(1)}%)`);

  const avgError = results.reduce((s, r) => s + r.error, 0) / results.length;
  const avgAbsError = results.reduce((s, r) => s + r.abs_error, 0) / results.length;
  const medianError = results.sort((a, b) => a.error - b.error)[Math.floor(results.length / 2)]?.error || 0;

  console.log(`\nAverage error: $${avgError.toFixed(2)}`);
  console.log(`Average absolute error: $${avgAbsError.toFixed(2)}`);
  console.log(`Median error: $${medianError.toFixed(2)}`);

  // Top 10 best
  results.sort((a, b) => a.abs_error - b.abs_error);
  console.log('\n=== Top 10 Best Matches ===\n');
  console.log('Wallet                                     | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(90));
  for (const r of results.slice(0, 10)) {
    console.log(
      `${r.wallet} | $${r.api_pnl.toFixed(2).padStart(11)} | $${r.calc_pnl.toFixed(2).padStart(11)} | $${r.error.toFixed(2)}`
    );
  }

  // Top 10 worst
  console.log('\n=== Top 10 Worst Matches ===\n');
  console.log('Wallet                                     | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(90));
  for (const r of results.slice(-10).reverse()) {
    console.log(
      `${r.wallet} | $${r.api_pnl.toFixed(2).padStart(11)} | $${r.calc_pnl.toFixed(2).padStart(11)} | $${r.error.toFixed(2)}`
    );
  }

  // By cohort
  console.log('\n=== Results by Cohort ===\n');
  console.log('Cohort Type      | Count | Avg Error     | Within $100 | Within $1000');
  console.log('-'.repeat(75));
  const cohorts = ['mixed', 'maker_heavy', 'taker_heavy'];
  for (const cohort of cohorts) {
    const items = results.filter(r => r.cohort === cohort);
    if (items.length === 0) continue;
    const avgErr = items.reduce((s, r) => s + r.error, 0) / items.length;
    const w100 = items.filter(r => r.abs_error <= 100).length;
    const w1000 = items.filter(r => r.abs_error <= 1000).length;
    console.log(
      `${cohort.padEnd(16)} | ${String(items.length).padStart(5)} | $${avgErr.toFixed(2).padStart(11)} | ` +
      `${String(w100).padStart(11)} | ${String(w1000).padStart(12)}`
    );
  }

  console.log('\n✅ Test complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
