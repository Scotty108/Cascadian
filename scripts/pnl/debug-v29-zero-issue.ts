/**
 * Debug V29 Zero Issue
 *
 * Investigates why V29 is returning $0 for wallets that should have negative PnL.
 * Checks payout_numerators parsing and resolution price extraction.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const TEST_WALLET = '0xd04f7c90bc6f15a29c744b4e974a19fcd7aa5acd';

async function debugV29Calculation() {
  console.log('='.repeat(80));
  console.log('DEBUG V29 ZERO ISSUE');
  console.log('='.repeat(80));
  console.log(`Test wallet: ${TEST_WALLET}`);
  console.log('');

  // Step 1: Check raw ledger data
  console.log('STEP 1: Raw ledger data with payout_numerators');
  console.log('-'.repeat(80));

  const rawQuery = `
    SELECT
      condition_id,
      outcome_index,
      source_type,
      usdc_delta,
      token_delta,
      payout_numerators,
      payout_norm
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      AND payout_numerators IS NOT NULL
      AND payout_numerators != ''
    LIMIT 10
  `;

  const rawResult = await clickhouse.query({ query: rawQuery, format: 'JSONEachRow' });
  const rawRows = await rawResult.json() as any[];

  console.log(`Found ${rawRows.length} rows with payout_numerators`);
  for (const row of rawRows) {
    console.log(`\nCondition: ${row.condition_id.slice(0, 10)}... outcome ${row.outcome_index}`);
    console.log(`  Source: ${row.source_type}`);
    console.log(`  USDC delta: ${row.usdc_delta}`);
    console.log(`  Token delta: ${row.token_delta}`);
    console.log(`  Payout numerators: ${row.payout_numerators}`);
    console.log(`  Payout norm: ${row.payout_norm}`);
  }

  // Step 2: Try different resolution price extraction methods
  console.log('\n\nSTEP 2: Testing resolution price extraction methods');
  console.log('-'.repeat(80));

  const testQuery = `
    WITH position_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_shares,
        any(payout_numerators) as payout_numerators,
        any(payout_norm) as payout_norm
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      GROUP BY condition_id, outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      cash_flow,
      final_shares,
      payout_numerators,
      payout_norm,
      -- Method 1: JSONExtractString
      toFloat64OrNull(JSONExtractString(payout_numerators, toString(outcome_index))) as method1_price,
      -- Method 2: Direct payout_norm
      payout_norm as method2_price
    FROM position_agg
    WHERE payout_numerators IS NOT NULL
    ORDER BY abs(cash_flow) DESC
    LIMIT 10
  `;

  const testResult = await clickhouse.query({ query: testQuery, format: 'JSONEachRow' });
  const testRows = await testResult.json() as any[];

  console.log(`\nTesting ${testRows.length} positions with resolutions:`);
  for (const row of testRows) {
    console.log(`\n${row.condition_id.slice(0, 10)}... outcome ${row.outcome_index}`);
    console.log(`  Cash flow: ${row.cash_flow}`);
    console.log(`  Final shares: ${row.final_shares}`);
    console.log(`  Payout numerators: ${row.payout_numerators}`);
    console.log(`  Method 1 (JSONExtractString): ${row.method1_price}`);
    console.log(`  Method 2 (payout_norm): ${row.method2_price}`);

    // Calculate PnL with each method
    if (row.method1_price !== null && row.method1_price !== undefined) {
      const pnl1 = row.cash_flow + (row.final_shares * row.method1_price);
      console.log(`  PnL (method 1): ${pnl1}`);
    }
    if (row.method2_price !== null && row.method2_price !== undefined) {
      const pnl2 = row.cash_flow + (row.final_shares * row.method2_price);
      console.log(`  PnL (method 2): ${pnl2}`);
    }
  }

  // Step 3: Check total PnL with corrected formula
  console.log('\n\nSTEP 3: Calculate total PnL with payout_norm');
  console.log('-'.repeat(80));

  const pnlQuery = `
    WITH position_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_shares,
        any(payout_norm) as payout_norm
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      GROUP BY condition_id, outcome_index
    )
    SELECT
      sum(cash_flow + (final_shares * COALESCE(payout_norm, 0))) as total_pnl,
      sum(CASE WHEN payout_norm IS NOT NULL THEN cash_flow + (final_shares * payout_norm) ELSE 0 END) as realized_pnl,
      sum(CASE WHEN payout_norm IS NULL THEN cash_flow + (final_shares * 0.5) ELSE 0 END) as unrealized_pnl,
      count() as total_conditions,
      sum(CASE WHEN payout_norm IS NOT NULL THEN 1 ELSE 0 END) as resolved_conditions
    FROM position_agg
  `;

  const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
  const pnlRows = await pnlResult.json() as any[];

  console.log('Using payout_norm field:');
  console.log(`  Total PnL: ${pnlRows[0].total_pnl}`);
  console.log(`  Realized PnL: ${pnlRows[0].realized_pnl}`);
  console.log(`  Unrealized PnL: ${pnlRows[0].unrealized_pnl}`);
  console.log(`  Total conditions: ${pnlRows[0].total_conditions}`);
  console.log(`  Resolved conditions: ${pnlRows[0].resolved_conditions}`);

  // Step 4: Compare against UI truth
  console.log('\n\nSTEP 4: Comparison with UI truth');
  console.log('-'.repeat(80));
  console.log('UI PnL (from truth dataset): -$21,562.36');
  console.log(`V29 PnL (payout_norm): $${pnlRows[0].total_pnl}`);
  console.log(`Error: ${Math.abs((pnlRows[0].total_pnl - (-21562.36)) / (-21562.36) * 100).toFixed(1)}%`);
}

debugV29Calculation().catch(console.error);
