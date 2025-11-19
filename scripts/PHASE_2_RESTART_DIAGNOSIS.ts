/**
 * PHASE 2 RESTART DIAGNOSIS
 *
 * Purpose: Verify that the 19x inflation is caused by broken pre-aggregated tables
 * and that the correct formula (from VERIFIED_CORRECT_PNL_APPROACH.md) works
 *
 * Strategy: Calculate P&L directly from trades_raw using side-aware cashflows
 */

import { client } from '../lib/clickhouse/client';

async function diagnosePhase2Blocker() {
  console.log('='.repeat(80));
  console.log('PHASE 2 RESTART DIAGNOSIS: Confirming root cause of 19x inflation');
  console.log('='.repeat(80));

  const wallet = 'niggemon';
  const expectedFromPolymarket = 101949.55;
  const expectedFromOurFormula = 99691.54;

  try {
    // ========================================================================
    // TEST 1: Confirm the pre-aggregated approach is broken (19x inflation)
    // ========================================================================
    console.log('\n[TEST 1] Pre-aggregated approach (KNOWN BROKEN):');
    console.log('Query: SUM(trade_cashflows_v3) for resolved conditions');

    const result1 = await client.query({
      query: `
        SELECT
          'Broken Pre-Aggregated' as approach,
          COUNT(*) as total_rows,
          SUM(cashflow_usdc) as total_pnl,
          ROUND(SUM(cashflow_usdc) / ${expectedFromOurFormula}, 2) as inflation_ratio
        FROM trade_cashflows_v3
        WHERE wallet = '${wallet}'
          AND is_resolved = 1
      `
    });

    const brokenResult = result1.data[0];
    console.log(`  Total rows: ${brokenResult.total_rows}`);
    console.log(`  Total P&L: $${brokenResult.total_pnl.toFixed(2)}`);
    console.log(`  Inflation ratio: ${brokenResult.inflation_ratio}x (EXPECTED: ~19x)`);

    // ========================================================================
    // TEST 2: Implement the correct formula from VERIFIED_CORRECT_PNL_APPROACH.md
    // ========================================================================
    console.log('\n[TEST 2] Correct approach (trades_raw + market_resolutions_final):');
    console.log('Formula: SUM(side-aware cashflows) + SUM(winning settlement)');

    const result2 = await client.query({
      query: `
        WITH normalized_trades AS (
          -- Step 1: Get all trades from trades_raw with normalized IDs
          SELECT
            wallet,
            market_id,
            condition_id,
            lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
            side,
            shares,
            entry_price,
            outcome_index,
            -- Side-aware cashflow: BUY = -price×shares, SELL = +price×shares
            IF(side = 'BUY',
              entry_price * shares * -1.0,
              entry_price * shares * 1.0
            ) as cashflow,
            -- Delta shares for settlement: BUY = +shares, SELL = -shares
            IF(side = 'BUY', shares, -shares) as delta_shares
          FROM trades_raw
          WHERE wallet = '${wallet}'
        ),

        with_resolutions AS (
          -- Step 2: Join to market_resolutions_final to get winning outcome
          SELECT
            nt.wallet,
            nt.market_id,
            nt.condition_id_norm,
            nt.outcome_index,
            nt.cashflow,
            nt.delta_shares,
            mr.winning_index,
            -- Settlement: only for shares in winning outcome, valued at $1.00
            IF(nt.outcome_index = mr.winning_index,
              nt.delta_shares * 1.0,
              0.0
            ) as settlement
          FROM normalized_trades nt
          LEFT JOIN market_resolutions_final mr
            ON nt.condition_id_norm = mr.condition_id_norm
        )

        -- Step 3: Calculate total P&L
        SELECT
          'Correct (trades_raw)' as approach,
          COUNT(*) as total_trades,
          SUM(cashflow) as total_cashflows,
          SUM(settlement) as total_settlement,
          SUM(cashflow) + SUM(settlement) as total_pnl,
          ROUND((SUM(cashflow) + SUM(settlement)) / ${expectedFromOurFormula}, 2) as accuracy_ratio
        FROM with_resolutions
        WHERE winning_index IS NOT NULL
      `
    });

    const correctResult = result2.data[0];
    console.log(`  Total trades: ${correctResult.total_trades}`);
    console.log(`  Cashflows: $${correctResult.total_cashflows.toFixed(2)}`);
    console.log(`  Settlement: $${correctResult.total_settlement.toFixed(2)}`);
    console.log(`  Total P&L: $${correctResult.total_pnl.toFixed(2)}`);
    console.log(`  Expected: $${expectedFromOurFormula.toFixed(2)}`);
    console.log(`  Accuracy: ${correctResult.accuracy_ratio}x (EXPECTED: ~1.0x)`);

    // ========================================================================
    // TEST 3: Verify against Polymarket expected value
    // ========================================================================
    console.log('\n[TEST 3] Validation against Polymarket profile:');
    console.log(`  Polymarket profile: $${expectedFromPolymarket.toFixed(2)}`);
    console.log(`  Our formula: $${correctResult.total_pnl.toFixed(2)}`);
    const variance = ((correctResult.total_pnl - expectedFromPolymarket) / expectedFromPolymarket) * 100;
    console.log(`  Variance: ${variance.toFixed(2)}% (EXPECTED: ~-2.3%)`);

    // ========================================================================
    // DIAGNOSIS CONCLUSION
    // ========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('DIAGNOSIS CONCLUSION');
    console.log('='.repeat(80));

    if (brokenResult.inflation_ratio >= 15) {
      console.log('✅ ROOT CAUSE CONFIRMED: Pre-aggregated tables have 19x inflation');
      console.log(`   (Pre-agg: $${brokenResult.total_pnl.toFixed(0)} vs Correct: $${correctResult.total_pnl.toFixed(0)})`);
    }

    if (Math.abs(variance) < 3) {
      console.log('✅ CORRECT FORMULA WORKS: trades_raw approach produces expected -2.3% variance');
      console.log(`   This is the formula that should be implemented`);
    }

    console.log('\n📋 ACTION ITEMS:');
    console.log('1. STOP iterating on pre-aggregated table fixes');
    console.log('2. Implement the trades_raw-based calculation (shown in TEST 2)');
    console.log('3. Use this exact SQL structure for all wallets');
    console.log('4. Reference: VERIFIED_CORRECT_PNL_APPROACH.md (Approach C)');

  } catch (error) {
    console.error('Error during diagnosis:', error);
    process.exit(1);
  }
}

diagnosePhase2Blocker();
