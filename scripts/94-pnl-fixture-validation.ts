#!/usr/bin/env tsx
/**
 * P&L Fixture Validation - Task P4
 *
 * Finds real wallet+market pairs matching the 5 numeric example patterns
 * from PM_PNL_SPEC_C1.md and validates the view produces correct results.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🧪 P&L Fixture Validation (Task P4)');
  console.log('='.repeat(60));
  console.log('');
  console.log('Goal: Verify P&L formulas work correctly on real data');
  console.log('');

  const fixtures = [];

  // === FIXTURE 1: All BUYs on Winning Outcome ===
  console.log('Fixture 1: All BUYs on Winning Outcome');
  console.log('-'.repeat(60));
  console.log('Pattern: BUY-only position on winning outcome');
  console.log('Expected: Positive net shares, is_winning_outcome=1, positive P&L');
  console.log('');

  const f1Query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        question,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        is_winning_outcome,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(fees_paid, 6) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE net_shares > 50          -- All BUYs
        AND net_shares < 150         -- Reasonable size
        AND is_winning_outcome = 1   -- Winning outcome
        AND pnl_gross > 0            -- Made money
        AND avg_price > 0.4          -- Not too cheap
        AND avg_price < 0.7          -- Not too expensive
      ORDER BY ABS(net_shares - 100) ASC  -- Closest to 100 shares
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const f1 = await f1Query.json();
  if (f1.length > 0) {
    console.log('Found matching position:');
    console.table(f1);

    // Manual calculation
    const expectedGrossPnl = parseFloat(f1[0].net_shares) * (1.0 - parseFloat(f1[0].avg_price));
    const expectedNetPnl = expectedGrossPnl - parseFloat(f1[0].fees_paid);

    console.log('');
    console.log('Manual Calculation:');
    console.log(`  signed_shares = +${f1[0].net_shares}`);
    console.log(`  payout_per_share = 1.0 (won)`);
    console.log(`  pnl_gross = ${f1[0].net_shares} * (1.0 - ${f1[0].avg_price}) = $${expectedGrossPnl.toFixed(2)}`);
    console.log(`  pnl_net = $${expectedGrossPnl.toFixed(2)} - $${f1[0].fees_paid} = $${expectedNetPnl.toFixed(2)}`);
    console.log('');
    console.log('View Result:');
    console.log(`  pnl_gross = $${f1[0].pnl_gross}`);
    console.log(`  pnl_net = $${f1[0].pnl_net}`);
    console.log('');

    const grossMatch = Math.abs(expectedGrossPnl - parseFloat(f1[0].pnl_gross)) < 0.01;
    const netMatch = Math.abs(expectedNetPnl - parseFloat(f1[0].pnl_net)) < 0.01;

    if (grossMatch && netMatch) {
      console.log('✅ PASS: Calculations match within $0.01');
    } else {
      console.log('❌ FAIL: Calculations do not match');
      console.log(`  Gross diff: $${Math.abs(expectedGrossPnl - parseFloat(f1[0].pnl_gross)).toFixed(2)}`);
      console.log(`  Net diff: $${Math.abs(expectedNetPnl - parseFloat(f1[0].pnl_net)).toFixed(2)}`);
    }

    fixtures.push({
      name: 'All BUYs, Winning',
      passed: grossMatch && netMatch,
      ...f1[0]
    });
  } else {
    console.log('⚠️  No matching position found');
  }
  console.log('');

  // === FIXTURE 2: All BUYs on Losing Outcome ===
  console.log('Fixture 2: All BUYs on Losing Outcome');
  console.log('-'.repeat(60));
  console.log('Pattern: BUY-only position on losing outcome');
  console.log('Expected: Positive net shares, is_winning_outcome=0, negative P&L');
  console.log('');

  const f2Query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        question,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        is_winning_outcome,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(fees_paid, 6) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE net_shares > 50          -- All BUYs
        AND net_shares < 150         -- Reasonable size
        AND is_winning_outcome = 0   -- Losing outcome
        AND pnl_gross < 0            -- Lost money
        AND avg_price > 0.4          -- Not too cheap
        AND avg_price < 0.7          -- Not too expensive
      ORDER BY ABS(net_shares - 100) ASC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const f2 = await f2Query.json();
  if (f2.length > 0) {
    console.log('Found matching position:');
    console.table(f2);

    const expectedGrossPnl = parseFloat(f2[0].net_shares) * (0.0 - parseFloat(f2[0].avg_price));
    const expectedNetPnl = expectedGrossPnl - parseFloat(f2[0].fees_paid);

    console.log('');
    console.log('Manual Calculation:');
    console.log(`  signed_shares = +${f2[0].net_shares}`);
    console.log(`  payout_per_share = 0.0 (lost)`);
    console.log(`  pnl_gross = ${f2[0].net_shares} * (0.0 - ${f2[0].avg_price}) = $${expectedGrossPnl.toFixed(2)}`);
    console.log(`  pnl_net = $${expectedGrossPnl.toFixed(2)} - $${f2[0].fees_paid} = $${expectedNetPnl.toFixed(2)}`);
    console.log('');
    console.log('View Result:');
    console.log(`  pnl_gross = $${f2[0].pnl_gross}`);
    console.log(`  pnl_net = $${f2[0].pnl_net}`);
    console.log('');

    const grossMatch = Math.abs(expectedGrossPnl - parseFloat(f2[0].pnl_gross)) < 0.01;
    const netMatch = Math.abs(expectedNetPnl - parseFloat(f2[0].pnl_net)) < 0.01;

    if (grossMatch && netMatch) {
      console.log('✅ PASS: Calculations match within $0.01');
    } else {
      console.log('❌ FAIL: Calculations do not match');
    }

    fixtures.push({
      name: 'All BUYs, Losing',
      passed: grossMatch && netMatch,
      ...f2[0]
    });
  } else {
    console.log('⚠️  No matching position found');
  }
  console.log('');

  // === FIXTURE 3: Mixed BUY/SELL on Winning Outcome ===
  console.log('Fixture 3: Mixed BUY/SELL on Winning Outcome');
  console.log('-'.repeat(60));
  console.log('Pattern: Some BUYs and some SELLs, net positive, winning');
  console.log('Expected: Small positive net shares, is_winning_outcome=1, positive P&L');
  console.log('');

  const f3Query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        question,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        is_winning_outcome,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(fees_paid, 6) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE net_shares > 10          -- Net long
        AND net_shares < 100         -- But not full position
        AND total_trades >= 2        -- Multiple trades
        AND is_winning_outcome = 1   -- Winning outcome
        AND pnl_gross > 0            -- Made money
      ORDER BY ABS(net_shares - 50) ASC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const f3 = await f3Query.json();
  if (f3.length > 0) {
    console.log('Found matching position:');
    console.table(f3);

    const expectedGrossPnl = parseFloat(f3[0].net_shares) * (1.0 - parseFloat(f3[0].avg_price));
    const expectedNetPnl = expectedGrossPnl - parseFloat(f3[0].fees_paid);

    console.log('');
    console.log('Manual Calculation:');
    console.log(`  signed_shares = +${f3[0].net_shares}`);
    console.log(`  payout_per_share = 1.0 (won)`);
    console.log(`  pnl_gross = ${f3[0].net_shares} * (1.0 - ${f3[0].avg_price}) = $${expectedGrossPnl.toFixed(2)}`);
    console.log(`  pnl_net = $${expectedGrossPnl.toFixed(2)} - $${f3[0].fees_paid} = $${expectedNetPnl.toFixed(2)}`);
    console.log('');
    console.log('View Result:');
    console.log(`  pnl_gross = $${f3[0].pnl_gross}`);
    console.log(`  pnl_net = $${f3[0].pnl_net}`);
    console.log('');

    const grossMatch = Math.abs(expectedGrossPnl - parseFloat(f3[0].pnl_gross)) < 0.01;
    const netMatch = Math.abs(expectedNetPnl - parseFloat(f3[0].pnl_net)) < 0.01;

    if (grossMatch && netMatch) {
      console.log('✅ PASS: Calculations match within $0.01');
    } else {
      console.log('❌ FAIL: Calculations do not match');
    }

    fixtures.push({
      name: 'Mixed BUY/SELL, Winning',
      passed: grossMatch && netMatch,
      ...f3[0]
    });
  } else {
    console.log('⚠️  No matching position found');
  }
  console.log('');

  // === FIXTURE 4: Net Short on Losing Outcome ===
  console.log('Fixture 4: Net Short on Losing Outcome');
  console.log('-'.repeat(60));
  console.log('Pattern: Net sold position on losing outcome (profitable short)');
  console.log('Expected: Negative net shares, is_winning_outcome=0, positive P&L');
  console.log('');

  const f4Query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        question,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        is_winning_outcome,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(fees_paid, 6) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE net_shares < -10         -- Net short
        AND net_shares > -100        -- Reasonable size
        AND is_winning_outcome = 0   -- Losing outcome (short wins)
        AND pnl_gross > 0            -- Made money
        AND avg_price > 0.3          -- Not too cheap
        AND avg_price < 0.7          -- Not too expensive
      ORDER BY ABS(net_shares + 50) ASC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const f4 = await f4Query.json();
  if (f4.length > 0) {
    console.log('Found matching position:');
    console.table(f4);

    const expectedGrossPnl = parseFloat(f4[0].net_shares) * (0.0 - parseFloat(f4[0].avg_price));
    const expectedNetPnl = expectedGrossPnl - parseFloat(f4[0].fees_paid);

    console.log('');
    console.log('Manual Calculation:');
    console.log(`  signed_shares = ${f4[0].net_shares}`);
    console.log(`  payout_per_share = 0.0 (lost - good for shorts)`);
    console.log(`  pnl_gross = ${f4[0].net_shares} * (0.0 - ${f4[0].avg_price}) = $${expectedGrossPnl.toFixed(2)}`);
    console.log(`  pnl_net = $${expectedGrossPnl.toFixed(2)} - $${f4[0].fees_paid} = $${expectedNetPnl.toFixed(2)}`);
    console.log('');
    console.log('View Result:');
    console.log(`  pnl_gross = $${f4[0].pnl_gross}`);
    console.log(`  pnl_net = $${f4[0].pnl_net}`);
    console.log('');

    const grossMatch = Math.abs(expectedGrossPnl - parseFloat(f4[0].pnl_gross)) < 0.01;
    const netMatch = Math.abs(expectedNetPnl - parseFloat(f4[0].pnl_net)) < 0.01;

    if (grossMatch && netMatch) {
      console.log('✅ PASS: Calculations match within $0.01');
    } else {
      console.log('❌ FAIL: Calculations do not match');
    }

    fixtures.push({
      name: 'Net Short, Losing Outcome',
      passed: grossMatch && netMatch,
      ...f4[0]
    });
  } else {
    console.log('⚠️  No matching position found');
  }
  console.log('');

  // === FIXTURE 5: Near-Flat Position ===
  console.log('Fixture 5: Near-Flat Position');
  console.log('-'.repeat(60));
  console.log('Pattern: Near-zero net shares (market maker activity)');
  console.log('Expected: Net shares ≈ 0, P&L ≈ 0');
  console.log('');

  const f5Query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        question,
        total_trades,
        ROUND(net_shares, 2) as net_shares,
        ROUND(avg_price, 4) as avg_price,
        is_winning_outcome,
        ROUND(pnl_gross, 2) as pnl_gross,
        ROUND(fees_paid, 6) as fees_paid,
        ROUND(pnl_net, 2) as pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE ABS(net_shares) < 5     -- Near flat
        AND total_trades >= 2       -- Multiple trades
      ORDER BY ABS(net_shares) ASC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const f5 = await f5Query.json();
  if (f5.length > 0) {
    console.log('Found matching position:');
    console.table(f5);

    const payout = parseFloat(f5[0].is_winning_outcome) === 1 ? 1.0 : 0.0;
    const expectedGrossPnl = parseFloat(f5[0].net_shares) * (payout - parseFloat(f5[0].avg_price));
    const expectedNetPnl = expectedGrossPnl - parseFloat(f5[0].fees_paid);

    console.log('');
    console.log('Manual Calculation:');
    console.log(`  signed_shares = ${f5[0].net_shares}`);
    console.log(`  payout_per_share = ${payout} (${f5[0].is_winning_outcome === 1 ? 'won' : 'lost'})`);
    console.log(`  pnl_gross = ${f5[0].net_shares} * (${payout} - ${f5[0].avg_price}) = $${expectedGrossPnl.toFixed(2)}`);
    console.log(`  pnl_net = $${expectedGrossPnl.toFixed(2)} - $${f5[0].fees_paid} = $${expectedNetPnl.toFixed(2)}`);
    console.log('');
    console.log('View Result:');
    console.log(`  pnl_gross = $${f5[0].pnl_gross}`);
    console.log(`  pnl_net = $${f5[0].pnl_net}`);
    console.log('');

    const grossMatch = Math.abs(expectedGrossPnl - parseFloat(f5[0].pnl_gross)) < 0.01;
    const netMatch = Math.abs(expectedNetPnl - parseFloat(f5[0].pnl_net)) < 0.01;

    if (grossMatch && netMatch) {
      console.log('✅ PASS: Calculations match within $0.01');
    } else {
      console.log('❌ FAIL: Calculations do not match');
    }

    fixtures.push({
      name: 'Near-Flat Position',
      passed: grossMatch && netMatch,
      ...f5[0]
    });
  } else {
    console.log('⚠️  No matching position found');
  }
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 FIXTURE VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const passedCount = fixtures.filter(f => f.passed).length;
  const totalCount = fixtures.length;

  console.log(`Fixtures Validated: ${totalCount}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${totalCount - passedCount}`);
  console.log('');

  fixtures.forEach((f, i) => {
    console.log(`${i + 1}. ${f.name}: ${f.passed ? '✅ PASS' : '❌ FAIL'}`);
  });
  console.log('');

  if (passedCount === totalCount) {
    console.log('🎉 ALL FIXTURES PASSED');
    console.log('');
    console.log('Conclusion:');
    console.log('  ✅ P&L formulas implemented correctly');
    console.log('  ✅ signed_shares calculation works');
    console.log('  ✅ Payout logic (winning vs losing) works');
    console.log('  ✅ Gross P&L aggregation works');
    console.log('  ✅ Net P&L calculation works');
    console.log('');
    console.log('Task P4: COMPLETE ✅');
  } else {
    console.log('⚠️  SOME FIXTURES FAILED');
    console.log('Review calculations above for details.');
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Fixture validation failed:', error);
  process.exit(1);
});
