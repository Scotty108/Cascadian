/**
 * Test NegRisk-aware engine with self-fill detection on all cohort types
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { calculateWalletPnL } from '../lib/pnl/pnlEngineNegRiskAware';

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Testing NegRisk-Aware Engine (All Cohorts) ===\n');

  // Get 5 wallets from each cohort type
  const query = `
    SELECT
      b.wallet,
      b.api_pnl,
      v.cohort_type,
      v.maker_ratio
    FROM pm_pnl_baseline_api_v2 b
    JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
    WHERE v.cohort_type IN ('maker_heavy', 'taker_heavy', 'mixed')
    ORDER BY v.cohort_type, rand()
    LIMIT 15
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];

  console.log(`Testing ${wallets.length} wallets across cohorts...\n`);

  const results: Array<{
    wallet: string;
    cohort: string;
    api_pnl: number;
    calc_pnl: number;
    error: number;
    ratio: number;
    maker_ratio: number;
  }> = [];

  for (const w of wallets) {
    process.stdout.write(`Testing ${w.wallet.slice(0, 10)}...`);

    try {
      const calcResult = await calculateWalletPnL(w.wallet);
      const apiPnl = Number(w.api_pnl);
      const error = calcResult.total_pnl - apiPnl;
      const ratio = apiPnl !== 0 ? calcResult.total_pnl / apiPnl : 0;

      results.push({
        wallet: w.wallet,
        cohort: w.cohort_type,
        api_pnl: apiPnl,
        calc_pnl: calcResult.total_pnl,
        error,
        ratio,
        maker_ratio: Number(w.maker_ratio),
      });
      console.log(` API: $${apiPnl.toFixed(2)}, Calc: $${calcResult.total_pnl.toFixed(2)}, Ratio: ${ratio.toFixed(2)}x`);
    } catch (e: any) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  // Summary by cohort
  console.log('\n=== Summary by Cohort ===\n');

  const cohorts = ['maker_heavy', 'taker_heavy', 'mixed'];
  console.log('Cohort       | Count | Avg Error     | Within $10  | Within $100 | Avg Ratio');
  console.log('-'.repeat(85));

  for (const cohort of cohorts) {
    const items = results.filter(r => r.cohort === cohort);
    if (items.length === 0) continue;

    const avgError = items.reduce((s, r) => s + r.error, 0) / items.length;
    const within10 = items.filter(r => Math.abs(r.error) <= 10).length;
    const within100 = items.filter(r => Math.abs(r.error) <= 100).length;
    const avgRatio = items.reduce((s, r) => s + r.ratio, 0) / items.length;

    console.log(
      `${cohort.padEnd(12)} | ${String(items.length).padStart(5)} | ` +
      `$${avgError.toFixed(2).padStart(11)} | ` +
      `${String(within10).padStart(11)} | ` +
      `${String(within100).padStart(11)} | ` +
      `${avgRatio.toFixed(2)}x`
    );
  }

  // Overall
  const avgError = results.reduce((s, r) => s + r.error, 0) / results.length;
  const within10 = results.filter(r => Math.abs(r.error) <= 10).length;
  const within100 = results.filter(r => Math.abs(r.error) <= 100).length;

  console.log('\n=== Overall ===\n');
  console.log(`Total tested: ${results.length}`);
  console.log(`Within $10: ${within10} (${(within10 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $100: ${within100} (${(within100 / results.length * 100).toFixed(1)}%)`);
  console.log(`Average error: $${avgError.toFixed(2)}`);

  console.log('\n✅ Test complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
