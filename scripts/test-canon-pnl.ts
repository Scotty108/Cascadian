/**
 * Test PnL accuracy using canonical fills table
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Testing PnL on Canonical Fills ===\n');

  // Calculate PnL for all validation wallets using canonical fills
  const pnlQuery = `
    WITH
      -- Aggregate cash flow per wallet
      cash_flow AS (
        SELECT
          wallet,
          sum(CASE WHEN side = 'sell' THEN usdc_amount / 1e6 ELSE 0 END) as total_sells,
          sum(CASE WHEN side = 'buy' THEN usdc_amount / 1e6 ELSE 0 END) as total_buys
        FROM pm_validation_fills_canon_v1
        GROUP BY wallet
      ),
      -- Calculate net position per condition/outcome
      positions AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          sum(CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END) as net_tokens
        FROM pm_validation_fills_canon_v1
        GROUP BY wallet, condition_id, outcome_index
      ),
      -- Get position value at resolution
      position_value AS (
        SELECT
          p.wallet,
          sum(
            CASE
              WHEN r.payout_numerators IS NULL OR r.payout_numerators = '' THEN 0
              WHEN p.net_tokens > 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 THEN p.net_tokens
              ELSE 0
            END
          ) as pos_value
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
        GROUP BY p.wallet
      )
    SELECT
      cf.wallet,
      cf.total_sells - cf.total_buys as cash_flow,
      coalesce(pv.pos_value, 0) as position_value,
      (cf.total_sells - cf.total_buys + coalesce(pv.pos_value, 0)) as calculated_pnl
    FROM cash_flow cf
    LEFT JOIN position_value pv ON cf.wallet = pv.wallet
  `;

  console.log('Calculating PnL for all 600 wallets...');
  const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const calculated = new Map<string, number>();
  for (const r of await pnlResult.json() as any[]) {
    calculated.set(r.wallet, Number(r.calculated_pnl));
  }
  console.log(`  Calculated PnL for ${calculated.size} wallets\n`);

  // Get API baseline
  const baselineQuery = `
    SELECT
      b.wallet,
      b.api_pnl,
      v.cohort_type,
      v.maker_ratio
    FROM pm_pnl_baseline_api_v2 b
    JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
  `;
  const baselineResult = await clickhouse.query({ query: baselineQuery, format: 'JSONEachRow' });
  const baseline = await baselineResult.json() as any[];

  // Compare
  const results: Array<{
    wallet: string;
    cohort: string;
    api_pnl: number;
    calc_pnl: number;
    error: number;
    abs_error: number;
  }> = [];

  for (const b of baseline) {
    const calc = calculated.get(b.wallet);
    if (calc === undefined) continue;

    const error = calc - Number(b.api_pnl);
    results.push({
      wallet: b.wallet,
      cohort: b.cohort_type,
      api_pnl: Number(b.api_pnl),
      calc_pnl: calc,
      error,
      abs_error: Math.abs(error),
    });
  }

  // Overall summary
  console.log('=== Overall Results ===\n');
  const within1 = results.filter(r => r.abs_error <= 1).length;
  const within10 = results.filter(r => r.abs_error <= 10).length;
  const within100 = results.filter(r => r.abs_error <= 100).length;
  const within1000 = results.filter(r => r.abs_error <= 1000).length;

  console.log(`Total wallets: ${results.length}`);
  console.log(`Within $1: ${within1} (${(within1 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $10: ${within10} (${(within10 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $100: ${within100} (${(within100 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $1000: ${within1000} (${(within1000 / results.length * 100).toFixed(1)}%)`);

  // By cohort
  console.log('\n=== By Cohort ===\n');
  console.log('Cohort       | Count | Within $1  | Within $10 | Within $100 | Avg Error');
  console.log('-'.repeat(80));

  const cohorts = ['maker_heavy', 'mixed', 'taker_heavy'];
  for (const cohort of cohorts) {
    const items = results.filter(r => r.cohort === cohort);
    if (items.length === 0) continue;

    const w1 = items.filter(r => r.abs_error <= 1).length;
    const w10 = items.filter(r => r.abs_error <= 10).length;
    const w100 = items.filter(r => r.abs_error <= 100).length;
    const avgErr = items.reduce((s, r) => s + r.error, 0) / items.length;

    console.log(
      `${cohort.padEnd(12)} | ${String(items.length).padStart(5)} | ` +
      `${String(w1).padStart(10)} | ` +
      `${String(w10).padStart(10)} | ` +
      `${String(w100).padStart(11)} | ` +
      `$${avgErr.toFixed(2)}`
    );
  }

  // Top 10 best matches
  results.sort((a, b) => a.abs_error - b.abs_error);
  console.log('\n=== Top 10 Best Matches ===\n');
  console.log('Wallet                                     | Cohort       | API         | Calc        | Error');
  console.log('-'.repeat(100));
  for (const r of results.slice(0, 10)) {
    console.log(
      `${r.wallet} | ${r.cohort.padEnd(12)} | ` +
      `$${r.api_pnl.toFixed(2).padStart(9)} | ` +
      `$${r.calc_pnl.toFixed(2).padStart(9)} | ` +
      `$${r.error.toFixed(4)}`
    );
  }

  // Top 10 worst
  console.log('\n=== Top 10 Worst Matches ===\n');
  console.log('Wallet                                     | Cohort       | API         | Calc        | Error');
  console.log('-'.repeat(100));
  for (const r of results.slice(-10).reverse()) {
    console.log(
      `${r.wallet} | ${r.cohort.padEnd(12)} | ` +
      `$${r.api_pnl.toFixed(2).padStart(9)} | ` +
      `$${r.calc_pnl.toFixed(2).padStart(9)} | ` +
      `$${r.error.toFixed(2)}`
    );
  }

  console.log('\n✅ Test complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
