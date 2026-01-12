/**
 * Fast Engine V1 - Simple PnL calculation on validation cohort
 *
 * Uses pm_validation_fills_norm_v1 (90K rows) for sub-second iteration.
 *
 * Basic formula:
 * - realized = cash received from sells - cash paid for buys (closed positions)
 * - unrealized = current position value at resolution/mark price
 * - total = realized + unrealized
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletPnL {
  wallet: string;
  calculated_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  buy_count: number;
  sell_count: number;
  total_buy_usdc: number;
  total_sell_usdc: number;
}

async function calculatePnL(): Promise<WalletPnL[]> {
  // Simple SQL-based PnL calculation
  // Formula: sum(usdc from sells) - sum(usdc from buys) + position value
  // For now, ignore unrealized and just compute realized
  const query = `
    WITH
      -- Aggregate by wallet (divide by 1e6 for human-readable amounts)
      wallet_trades AS (
        SELECT
          wallet,
          -- Cash flow: sells give USDC, buys cost USDC
          sum(CASE WHEN side = 'sell' THEN usdc_amount / 1e6 ELSE 0 END) as total_sell_usdc,
          sum(CASE WHEN side = 'buy' THEN usdc_amount / 1e6 ELSE 0 END) as total_buy_usdc,
          countIf(side = 'buy') as buy_count,
          countIf(side = 'sell') as sell_count,
          -- Net token positions by (condition_id, outcome_index)
          sum(CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END) as net_tokens
        FROM pm_validation_fills_norm_v1
        GROUP BY wallet
      ),

      -- Get resolution data to compute unrealized PnL
      -- payout_numerators is like '[1,0]' where index matches outcome_index
      position_values AS (
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          sum(CASE WHEN f.side = 'buy' THEN f.token_amount / 1e6 ELSE -f.token_amount / 1e6 END) as net_tokens,
          -- Get payout for this outcome_index from payout_numerators array
          any(r.payout_numerators) as payout_numerators
        FROM pm_validation_fills_norm_v1 f
        LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        GROUP BY f.wallet, f.condition_id, f.outcome_index
      ),

      -- Compute position value based on resolution
      wallet_position_value AS (
        SELECT
          wallet,
          sum(
            CASE
              WHEN payout_numerators IS NULL OR payout_numerators = '' THEN 0  -- Unresolved: ignore
              -- Parse payout_numerators like '[1,0]' and get value at outcome_index+1 (1-indexed)
              WHEN toInt64OrNull(JSONExtractString(payout_numerators, outcome_index + 1)) = 1 THEN net_tokens  -- Won
              ELSE 0  -- Lost
            END
          ) as position_value
        FROM position_values
        WHERE net_tokens > 0  -- Only count long positions
        GROUP BY wallet
      )

    SELECT
      t.wallet,
      t.total_sell_usdc,
      t.total_buy_usdc,
      t.buy_count,
      t.sell_count,
      coalesce(p.position_value, 0) as position_value,
      -- Realized PnL: sells - buys
      t.total_sell_usdc - t.total_buy_usdc as realized_pnl,
      -- Total PnL: realized + position value
      (t.total_sell_usdc - t.total_buy_usdc + coalesce(p.position_value, 0)) as calculated_pnl
    FROM wallet_trades t
    LEFT JOIN wallet_position_value p ON t.wallet = p.wallet
    ORDER BY t.wallet
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet: r.wallet,
    calculated_pnl: Number(r.calculated_pnl),
    realized_pnl: Number(r.realized_pnl),
    unrealized_pnl: Number(r.position_value),
    buy_count: Number(r.buy_count),
    sell_count: Number(r.sell_count),
    total_buy_usdc: Number(r.total_buy_usdc),
    total_sell_usdc: Number(r.total_sell_usdc),
  }));
}

async function compareToBaseline(calculated: WalletPnL[]) {
  // Get API baseline
  const baselineResult = await clickhouse.query({
    query: `
      SELECT b.wallet, b.api_pnl, v.cohort_type, v.maker_ratio, v.trade_count
      FROM pm_pnl_baseline_api_v2 b
      JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
    `,
    format: 'JSONEachRow'
  });

  const baseline = new Map<string, { api_pnl: number; cohort_type: string; maker_ratio: number; trade_count: number }>();
  for (const r of await baselineResult.json() as any[]) {
    baseline.set(r.wallet, {
      api_pnl: Number(r.api_pnl),
      cohort_type: r.cohort_type,
      maker_ratio: Number(r.maker_ratio),
      trade_count: Number(r.trade_count),
    });
  }

  // Compare
  const results: Array<{
    wallet: string;
    cohort_type: string;
    api_pnl: number;
    calculated_pnl: number;
    error: number;
    error_pct: number;
    maker_ratio: number;
  }> = [];

  for (const calc of calculated) {
    const base = baseline.get(calc.wallet);
    if (!base) continue;

    const error = calc.calculated_pnl - base.api_pnl;
    const error_pct = base.api_pnl !== 0 ? Math.abs(error / base.api_pnl) * 100 : (error === 0 ? 0 : Infinity);

    results.push({
      wallet: calc.wallet,
      cohort_type: base.cohort_type,
      api_pnl: base.api_pnl,
      calculated_pnl: calc.calculated_pnl,
      error,
      error_pct,
      maker_ratio: base.maker_ratio,
    });
  }

  return results;
}

async function main() {
  console.log('=== Fast Engine V1 - Validation Run ===\n');

  // Step 1: Calculate PnL
  console.log('Step 1: Calculating PnL from validation fills...');
  const startCalc = Date.now();
  const calculated = await calculatePnL();
  const calcTime = Date.now() - startCalc;
  console.log(`  Calculated ${calculated.length} wallets in ${calcTime}ms\n`);

  // Step 2: Compare to baseline
  console.log('Step 2: Comparing to API baseline...');
  const startCompare = Date.now();
  const comparison = await compareToBaseline(calculated);
  const compareTime = Date.now() - startCompare;
  console.log(`  Compared ${comparison.length} wallets in ${compareTime}ms\n`);

  // Step 3: Analyze by cohort
  console.log('=== Results by Cohort ===\n');

  const byCohort = new Map<string, typeof comparison>();
  for (const r of comparison) {
    const list = byCohort.get(r.cohort_type) || [];
    list.push(r);
    byCohort.set(r.cohort_type, list);
  }

  console.log('Cohort Type      | Count | Avg Error     | Median Error  | Within 10% | Within $100');
  console.log('-'.repeat(90));

  for (const [cohort, items] of byCohort) {
    items.sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
    const medianError = items[Math.floor(items.length / 2)]?.error || 0;
    const avgError = items.reduce((sum, r) => sum + r.error, 0) / items.length;
    const within10pct = items.filter(r => r.error_pct <= 10).length;
    const within100 = items.filter(r => Math.abs(r.error) <= 100).length;

    console.log(
      `${cohort.padEnd(16)} | ${String(items.length).padStart(5)} | ` +
      `$${avgError.toFixed(2).padStart(11)} | ` +
      `$${medianError.toFixed(2).padStart(11)} | ` +
      `${String(within10pct).padStart(10)} | ` +
      `${String(within100).padStart(11)}`
    );
  }

  // Step 4: Worst cases
  console.log('\n=== Top 10 Worst Errors ===\n');
  comparison.sort((a, b) => Math.abs(b.error) - Math.abs(a.error));

  console.log('Wallet                                     | Cohort       | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(100));
  for (const r of comparison.slice(0, 10)) {
    console.log(
      `${r.wallet} | ${r.cohort_type.padEnd(12)} | ` +
      `$${r.api_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.calculated_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.error.toFixed(2)}`
    );
  }

  // Step 5: Best cases (smallest errors)
  console.log('\n=== Top 10 Best Matches ===\n');
  comparison.sort((a, b) => Math.abs(a.error) - Math.abs(b.error));

  console.log('Wallet                                     | Cohort       | API PnL       | Calc PnL      | Error');
  console.log('-'.repeat(100));
  for (const r of comparison.slice(0, 10)) {
    console.log(
      `${r.wallet} | ${r.cohort_type.padEnd(12)} | ` +
      `$${r.api_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.calculated_pnl.toFixed(2).padStart(11)} | ` +
      `$${r.error.toFixed(2)}`
    );
  }

  console.log(`\n✅ Total time: ${calcTime + compareTime}ms`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
