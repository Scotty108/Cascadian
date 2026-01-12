/**
 * Test PnL accuracy on wallets WITHOUT phantom inventory
 * These wallets don't use NegRisk minting, so CLOB-only calculation should work
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Testing PnL on No-Phantom Wallets ===\n');

  // Get wallets with no phantom inventory
  const walletsQuery = `
    WITH wallet_inventory AS (
      SELECT
        wallet,
        sumIf(token_amount / 1e6, outcome_index = 0 AND side = 'buy') as yes_bought,
        sumIf(token_amount / 1e6, outcome_index = 0 AND side = 'sell') as yes_sold,
        sumIf(token_amount / 1e6, outcome_index = 1 AND side = 'buy') as no_bought,
        sumIf(token_amount / 1e6, outcome_index = 1 AND side = 'sell') as no_sold
      FROM pm_validation_fills_canon_v1
      GROUP BY wallet
      HAVING yes_sold <= yes_bought * 1.01 AND no_sold <= no_bought * 1.01
    )
    SELECT
      i.wallet,
      b.api_pnl,
      v.cohort_type
    FROM wallet_inventory i
    JOIN pm_pnl_baseline_api_v2 b ON i.wallet = b.wallet
    JOIN pm_validation_wallets_v2 v ON i.wallet = v.wallet
  `;
  const walletsResult = await clickhouse.query({ query: walletsQuery, format: 'JSONEachRow' });
  const wallets = await walletsResult.json() as Array<{ wallet: string; api_pnl: number; cohort_type: string }>;
  console.log(`Found ${wallets.length} no-phantom wallets\n`);

  // Calculate PnL using simple V1 formula: cash_flow + position_value
  const pnlQuery = `
    WITH
      cash_flow AS (
        SELECT
          wallet,
          sum(CASE WHEN side = 'sell' THEN usdc_amount / 1e6 ELSE 0 END) as total_sells,
          sum(CASE WHEN side = 'buy' THEN usdc_amount / 1e6 ELSE 0 END) as total_buys
        FROM pm_validation_fills_canon_v1
        GROUP BY wallet
      ),
      positions AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          sum(CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END) as net_tokens
        FROM pm_validation_fills_canon_v1
        GROUP BY wallet, condition_id, outcome_index
      ),
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

  const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const calculated = new Map<string, number>();
  for (const r of await pnlResult.json() as any[]) {
    calculated.set(r.wallet, Number(r.calculated_pnl));
  }

  // Compare
  const results: Array<{
    wallet: string;
    cohort: string;
    api_pnl: number;
    calc_pnl: number;
    error: number;
    abs_error: number;
  }> = [];

  for (const w of wallets) {
    const calc = calculated.get(w.wallet);
    if (calc === undefined) continue;

    const error = calc - Number(w.api_pnl);
    results.push({
      wallet: w.wallet,
      cohort: w.cohort_type,
      api_pnl: Number(w.api_pnl),
      calc_pnl: calc,
      error,
      abs_error: Math.abs(error),
    });
  }

  // Summary
  console.log('=== Results Summary ===\n');
  const within1 = results.filter(r => r.abs_error <= 1).length;
  const within10 = results.filter(r => r.abs_error <= 10).length;
  const within100 = results.filter(r => r.abs_error <= 100).length;
  const within1000 = results.filter(r => r.abs_error <= 1000).length;

  console.log(`Total wallets: ${results.length}`);
  console.log(`Within $1: ${within1} (${(within1 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $10: ${within10} (${(within10 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $100: ${within100} (${(within100 / results.length * 100).toFixed(1)}%)`);
  console.log(`Within $1000: ${within1000} (${(within1000 / results.length * 100).toFixed(1)}%)`);

  const avgError = results.reduce((s, r) => s + r.error, 0) / results.length;
  const avgAbsError = results.reduce((s, r) => s + r.abs_error, 0) / results.length;
  console.log(`\nAverage error: $${avgError.toFixed(2)}`);
  console.log(`Average absolute error: $${avgAbsError.toFixed(2)}`);

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

  // Top 10 best
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
