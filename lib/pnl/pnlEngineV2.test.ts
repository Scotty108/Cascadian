/**
 * PnL Engine V2 - TDD Test Suite
 *
 * This test suite validates the V2 PnL engine (CTF-aware bundled split detection)
 * against known UI values.
 *
 * Test Categories:
 * 1. CLOB-only wallets (must match V1 exactly - regression check)
 * 2. Split users (broken in V1, V2 should fix using CTF event joins)
 * 3. Scale test (2 random wallets)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Test data: All validated wallets with UI-confirmed PnL
export const TEST_WALLETS = {
  // Category 1: CLOB-only (V1 works perfectly, V2 must also work)
  clob_only: [
    { name: 'original', wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', ui_pnl: 1.16 },
    { name: 'maker_heavy_1', wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', ui_pnl: -12.60 },
    { name: 'maker_heavy_2', wallet: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', ui_pnl: 1500.00 },
    { name: 'taker_heavy_1', wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', ui_pnl: -47.19 },
    { name: 'taker_heavy_2', wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', ui_pnl: -73.00 },
    { name: 'mixed_1', wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', ui_pnl: -0.01 },
    { name: 'mixed_2', wallet: '0x8a8752f8c1b6e8bbdd4d8c47d6298e3a25a421f7', ui_pnl: 4916.75 },
  ],

  // Category 2: Split users (V1 overcounts, V2 must fix with CTF event join)
  split_users: [
    {
      name: 'copy_trading_pond',
      wallet: '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e',
      ui_pnl: 57.71,
      v1_pnl: 314.26,  // V1 overcounts by 5.4x
      issue: 'bundled_splits'
    },
  ],

  // Category 3: Scale test wallets (from 50-wallet validation)
  scale_test: [
    { name: '3w21binFf', wallet: '0x99d14ecb7e61f81ae972b9ae792f8f3f32ef65db', ui_pnl: -2429.89 },
    { name: 'Mistswirl', wallet: '0x29f8ad6b0cb15de715eb3954d14fe799944eed77', ui_pnl: -1470.50 },
  ],
};

// Helper to check if PnL is within tolerance
function isWithinTolerance(calculated: number, expected: number, tolerancePercent: number = 1): boolean {
  if (expected === 0) return Math.abs(calculated) < 0.10; // $0.10 absolute for zero
  const delta = Math.abs((calculated - expected) / expected) * 100;
  return delta <= tolerancePercent;
}

// Main test runner
async function runTests() {
  console.log('=== PnL Engine V2 TDD Test Suite ===');
  console.log('Testing CTF-aware bundled split detection\n');

  // Import V2 engine
  const { getWalletPnLV2 } = await import('./pnlEngineV2');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  // Test Category 1: CLOB-only wallets (regression check)
  console.log('--- Category 1: CLOB-Only Wallets (Regression Check) ---');
  for (const test of TEST_WALLETS.clob_only) {
    try {
      const result = await getWalletPnLV2(test.wallet);
      const calculated = result.total;
      const match = isWithinTolerance(calculated, test.ui_pnl, 1); // 1% tolerance

      if (match) {
        console.log(`✅ ${test.name}: $${calculated.toFixed(2)} ≈ $${test.ui_pnl} (UI)`);
        if (result.bundledSplitTxs > 0) {
          console.log(`   📊 Bundled splits: ${result.bundledSplitTxs}, Split cost: $${result.splitCostFromCtf.toFixed(2)}`);
        }
        passed++;
      } else {
        const delta = ((calculated - test.ui_pnl) / Math.abs(test.ui_pnl) * 100).toFixed(1);
        console.log(`❌ ${test.name}: $${calculated.toFixed(2)} ≠ $${test.ui_pnl} (${delta}% off)`);
        failed++;
        failures.push(`${test.name}: expected $${test.ui_pnl}, got $${calculated.toFixed(2)}`);
      }
    } catch (e) {
      console.log(`❌ ${test.name}: ERROR - ${e}`);
      failed++;
      failures.push(`${test.name}: ${e}`);
    }
  }

  // Test Category 2: Split users (the fix)
  console.log('\n--- Category 2: Split Users (V2 Fix Target) ---');
  for (const test of TEST_WALLETS.split_users) {
    try {
      const result = await getWalletPnLV2(test.wallet);
      const calculated = result.total;
      const match = isWithinTolerance(calculated, test.ui_pnl, 10); // 10% tolerance for split users

      console.log(`   📊 Bundled splits detected: ${result.bundledSplitTxs}`);
      console.log(`   📊 Split cost from CTF: $${result.splitCostFromCtf.toFixed(2)}`);
      console.log(`   📊 Regular CLOB cost: $${result.regularClobCost.toFixed(2)}`);

      if (match) {
        console.log(`✅ ${test.name}: $${calculated.toFixed(2)} ≈ $${test.ui_pnl} (UI) 🎉`);
        passed++;
      } else {
        const delta = ((calculated - test.ui_pnl) / Math.abs(test.ui_pnl) * 100).toFixed(1);
        console.log(`❌ ${test.name}: $${calculated.toFixed(2)} ≠ $${test.ui_pnl} (${delta}% off)`);
        console.log(`   Issue: ${test.issue}, V1 returned: $${test.v1_pnl}`);
        failed++;
        failures.push(`${test.name}: expected $${test.ui_pnl}, got $${calculated.toFixed(2)} (issue: ${test.issue})`);
      }
    } catch (e) {
      console.log(`❌ ${test.name}: ERROR - ${e}`);
      failed++;
      failures.push(`${test.name}: ${e}`);
    }
  }

  // Test Category 3: Scale test
  console.log('\n--- Category 3: Scale Test Wallets ---');
  for (const test of TEST_WALLETS.scale_test) {
    try {
      const result = await getWalletPnLV2(test.wallet);
      const calculated = result.total;
      const match = isWithinTolerance(calculated, test.ui_pnl, 1); // 1% tolerance

      if (match) {
        console.log(`✅ ${test.name}: $${calculated.toFixed(2)} ≈ $${test.ui_pnl} (UI)`);
        if (result.bundledSplitTxs > 0) {
          console.log(`   📊 Bundled splits: ${result.bundledSplitTxs}, Split cost: $${result.splitCostFromCtf.toFixed(2)}`);
        }
        passed++;
      } else {
        const delta = ((calculated - test.ui_pnl) / Math.abs(test.ui_pnl) * 100).toFixed(1);
        console.log(`❌ ${test.name}: $${calculated.toFixed(2)} ≠ $${test.ui_pnl} (${delta}% off)`);
        failed++;
        failures.push(`${test.name}: expected $${test.ui_pnl}, got $${calculated.toFixed(2)}`);
      }
    } catch (e) {
      console.log(`❌ ${test.name}: ERROR - ${e}`);
      failed++;
      failures.push(`${test.name}: ${e}`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }

  if (passed === passed + failed) {
    console.log('\n🎉 All tests passed! V2 is ready for production.');
  }

  return { passed, failed, failures };
}

// Oversell detection query (for debugging)
export async function detectOversellPatterns(wallet: string) {
  const { clickhouse } = await import('../clickhouse/client');

  const query = `
    WITH trades AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND m.condition_id IS NOT NULL
      GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, m.question, t.side
    ),
    positions AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds
      FROM trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      substring(question, 1, 50) as market,
      outcome_index,
      round(bought, 2) as bought,
      round(sold, 2) as sold,
      round(sold - bought, 2) as oversell_tokens,
      round((sold - bought) * 0.50, 2) as implied_split_cost,
      round(sell_proceeds, 2) as sell_proceeds,
      round(buy_cost, 2) as buy_cost
    FROM positions
    WHERE sold > bought
    ORDER BY (sold - bought) DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json();
}

// Run if executed directly
if (require.main === module) {
  runTests()
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
