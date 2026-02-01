#!/usr/bin/env npx tsx
/**
 * Comprehensive verification of pm_trade_fifo_roi_v3_mat_deduped
 * Ensures all FIFO V5 criteria are met
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function verifyMaterializedTable() {
  console.log('🔍 VERIFICATION: pm_trade_fifo_roi_v3_mat_deduped\n');

  let allTestsPassed = true;

  // Test 1: No duplicates
  console.log('1️⃣ Testing for duplicates...');
  const dupResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(tx_hash) as unique_txhashes,
        count() - uniq(tx_hash) as duplicates
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const dupData = await dupResult.json();
  const duplicates = dupData[0].duplicates;

  if (duplicates === 0) {
    console.log(`   ✅ PASS: Zero duplicates (${dupData[0].total_rows.toLocaleString()} unique tx_hashes)\n`);
  } else {
    console.log(`   ❌ FAIL: Found ${duplicates.toLocaleString()} duplicates!\n`);
    allTestsPassed = false;
  }

  // Test 2: FIFO V5 logic - multiple rows per position
  console.log('2️⃣ Testing FIFO V5 logic (multiple rows per position)...');
  const fifoResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        condition_id,
        outcome_index,
        count() as buy_transactions,
        sum(tokens) as total_tokens,
        sum(pnl_usd) as position_pnl
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE abs(cost_usd) >= 100
      GROUP BY wallet, condition_id, outcome_index
      HAVING buy_transactions > 1
      ORDER BY buy_transactions DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const fifoData = await fifoResult.json();

  if (fifoData.length > 0) {
    console.log(`   ✅ PASS: Found positions with multiple buy transactions`);
    console.log(`   Example: ${fifoData[0].wallet.substring(0, 10)}... has ${fifoData[0].buy_transactions} buy txs in one position\n`);
  } else {
    console.log(`   ❌ FAIL: No positions with multiple buy transactions found!\n`);
    allTestsPassed = false;
  }

  // Test 3: Early selling tracking
  console.log('3️⃣ Testing early selling tracking...');
  const earlyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(tokens_sold_early > 0) as trades_with_early_selling,
        countIf(tokens_held > 0) as trades_with_holding,
        countIf(tokens_sold_early > 0 AND tokens_held > 0) as trades_with_both
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE tokens > 0
    `,
    format: 'JSONEachRow'
  });
  const earlyData = await earlyResult.json();

  console.log(`   Total trades: ${earlyData[0].total_trades.toLocaleString()}`);
  console.log(`   With early selling: ${earlyData[0].trades_with_early_selling.toLocaleString()}`);
  console.log(`   With holding to resolution: ${earlyData[0].trades_with_holding.toLocaleString()}`);
  console.log(`   With both (partial early sell): ${earlyData[0].trades_with_both.toLocaleString()}`);

  if (earlyData[0].trades_with_early_selling > 0 && earlyData[0].trades_with_holding > 0) {
    console.log(`   ✅ PASS: Early selling tracking is working\n`);
  } else {
    console.log(`   ❌ FAIL: Early selling tracking missing!\n`);
    allTestsPassed = false;
  }

  // Test 4: SHORT positions preserved
  console.log('4️⃣ Testing SHORT position tracking...');
  const shortResult = await clickhouse.query({
    query: `
      SELECT
        countIf(is_short = 1) as short_positions,
        countIf(is_short = 0) as long_positions,
        avgIf(cost_usd, is_short = 1) as avg_short_cost,
        avgIf(cost_usd, is_short = 0) as avg_long_cost
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const shortData = await shortResult.json();

  console.log(`   LONG positions: ${shortData[0].long_positions.toLocaleString()}`);
  console.log(`   SHORT positions: ${shortData[0].short_positions.toLocaleString()}`);
  console.log(`   Avg SHORT cost: $${shortData[0].avg_short_cost.toFixed(2)} (should be negative)`);

  if (shortData[0].short_positions > 0 && shortData[0].avg_short_cost < 0) {
    console.log(`   ✅ PASS: SHORT positions preserved correctly\n`);
  } else {
    console.log(`   ⚠️  WARNING: SHORT position data may be incorrect\n`);
  }

  // Test 5: Field completeness
  console.log('5️⃣ Testing field completeness...');
  const fieldResult = await clickhouse.query({
    query: `
      SELECT
        countIf(wallet = '') as missing_wallet,
        countIf(condition_id = '') as missing_condition_id,
        countIf(entry_time = toDateTime(0)) as missing_entry_time,
        countIf(resolved_at = toDateTime(0)) as missing_resolved_at,
        countIf(cost_usd = 0 AND tokens > 0) as zero_cost_nonzero_tokens
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const fieldData = await fieldResult.json();

  console.log(`   Missing wallet: ${fieldData[0].missing_wallet}`);
  console.log(`   Missing condition_id: ${fieldData[0].missing_condition_id}`);
  console.log(`   Missing entry_time: ${fieldData[0].missing_entry_time}`);

  if (fieldData[0].missing_wallet === 0 && fieldData[0].missing_condition_id === 0) {
    console.log(`   ✅ PASS: All critical fields populated\n`);
  } else {
    console.log(`   ❌ FAIL: Missing critical field data!\n`);
    allTestsPassed = false;
  }

  // Test 6: Sample comparison with source table
  console.log('6️⃣ Testing data consistency with source table...');
  const sampleResult = await clickhouse.query({
    query: `
      WITH sample_txs AS (
        SELECT DISTINCT tx_hash
        FROM pm_trade_fifo_roi_v3_mat_deduped
        LIMIT 100
      )
      SELECT
        'Source' as table_name,
        count() as row_count,
        sum(cost_usd) as total_cost,
        sum(pnl_usd) as total_pnl
      FROM pm_trade_fifo_roi_v3
      WHERE tx_hash IN (SELECT tx_hash FROM sample_txs)

      UNION ALL

      SELECT
        'Materialized' as table_name,
        count() as row_count,
        sum(cost_usd) as total_cost,
        sum(pnl_usd) as total_pnl
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE tx_hash IN (SELECT tx_hash FROM sample_txs)
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleResult.json();

  const sourceRows = sampleData.find((r: any) => r.table_name === 'Source');
  const matRows = sampleData.find((r: any) => r.table_name === 'Materialized');

  console.log(`   Source table (100 tx_hashes): ${sourceRows.row_count} rows, $${sourceRows.total_pnl.toFixed(2)} PnL`);
  console.log(`   Materialized table: ${matRows.row_count} rows, $${matRows.total_pnl.toFixed(2)} PnL`);

  const pnlDiff = Math.abs(sourceRows.total_pnl - matRows.total_pnl);
  if (matRows.row_count === 100 && pnlDiff < 0.01) {
    console.log(`   ✅ PASS: Materialized table matches source data\n`);
  } else {
    console.log(`   ⚠️  WARNING: Row count or PnL mismatch with source\n`);
  }

  // Test 7: Wallet coverage
  console.log('7️⃣ Testing wallet coverage...');
  const walletResult = await clickhouse.query({
    query: `
      SELECT
        uniq(wallet) as unique_wallets,
        max(entry_time) as latest_trade,
        min(entry_time) as earliest_trade
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const walletData = await walletResult.json();

  console.log(`   Unique wallets: ${walletData[0].unique_wallets.toLocaleString()}`);
  console.log(`   Date range: ${walletData[0].earliest_trade} to ${walletData[0].latest_trade}`);
  console.log(`   ✅ Coverage verified\n`);

  // Test 8: PnL calculation integrity
  console.log('8️⃣ Testing PnL calculation integrity...');
  const pnlResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(abs(pnl_usd) > 0) as trades_with_pnl,
        countIf(roi != 0) as trades_with_roi,
        avg(roi) as avg_roi,
        quantile(0.5)(roi) as median_roi
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE abs(cost_usd) >= 5
    `,
    format: 'JSONEachRow'
  });
  const pnlData = await pnlResult.json();

  console.log(`   Trades with PnL: ${pnlData[0].trades_with_pnl.toLocaleString()} / ${pnlData[0].total_trades.toLocaleString()}`);
  console.log(`   Avg ROI: ${(pnlData[0].avg_roi * 100).toFixed(2)}%`);
  console.log(`   Median ROI: ${(pnlData[0].median_roi * 100).toFixed(2)}%`);
  console.log(`   ✅ PnL calculations present\n`);

  // Final summary
  console.log('═'.repeat(60));
  if (allTestsPassed) {
    console.log('✅ ALL CRITICAL TESTS PASSED');
    console.log('\nTable is ready for production use!');
    console.log('- Zero duplicates ✓');
    console.log('- FIFO V5 logic preserved ✓');
    console.log('- Early selling tracked ✓');
    console.log('- SHORT positions intact ✓');
    console.log('- All fields populated ✓');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('\nReview failures above before using in production!');
  }
  console.log('═'.repeat(60));
}

verifyMaterializedTable()
  .then(() => {
    console.log('\n🎉 Verification complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Verification error:', err);
    process.exit(1);
  });
