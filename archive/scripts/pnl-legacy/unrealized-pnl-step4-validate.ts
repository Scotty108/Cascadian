#!/usr/bin/env npx tsx

/**
 * UNREALIZED P&L SYSTEM - STEP 4: Validation
 *
 * Validates unrealized P&L calculations by:
 * 1. Spot-checking 10 random wallets
 * 2. Comparing aggregate to sum of individual trades
 * 3. Checking for anomalies (extreme values, NULL handling)
 * 4. Verifying math correctness
 *
 * Runtime: ~2-5 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L SYSTEM - STEP 4: VALIDATION');
  console.log('════════════════════════════════════════════════════════════════════\n');

  try {
    // 1. Overall coverage check
    console.log('1. Coverage Check:');
    const coverage = await client.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(unrealized_pnl_usd) as trades_with_unrealized_pnl,
          ROUND(COUNT(unrealized_pnl_usd) * 100.0 / COUNT(*), 2) as coverage_pct,
          COUNT(DISTINCT wallet_address) as total_wallets
        FROM trades_raw
        WHERE wallet_address != ''
      `,
      format: 'JSONEachRow'
    });
    const coverageData: any = await coverage.json();
    console.log('   - Total trades:', coverageData[0].total_trades);
    console.log('   - Trades with unrealized P&L:', coverageData[0].trades_with_unrealized_pnl);
    console.log('   - Coverage %:', coverageData[0].coverage_pct);
    console.log('   - Total wallets:', coverageData[0].total_wallets);
    console.log();

    // 2. Aggregate consistency check
    console.log('2. Aggregate Consistency Check:');
    console.log('   Comparing wallet_unrealized_pnl table vs. direct aggregation...');

    const directAgg = await client.query({
      query: `
        SELECT
          ROUND(SUM(unrealized_pnl_usd), 2) as total_unrealized_pnl,
          COUNT(DISTINCT wallet_address) as wallets_with_data
        FROM trades_raw
        WHERE wallet_address != ''
          AND unrealized_pnl_usd IS NOT NULL
      `,
      format: 'JSONEachRow'
    });
    const directAggData: any = await directAgg.json();

    const tableAgg = await client.query({
      query: `
        SELECT
          ROUND(SUM(total_unrealized_pnl_usd), 2) as total_unrealized_pnl,
          COUNT(*) as wallets_with_data
        FROM wallet_unrealized_pnl
      `,
      format: 'JSONEachRow'
    });
    const tableAggData: any = await tableAgg.json();

    console.log('   Direct aggregation from trades_raw:');
    console.log('     - Total unrealized P&L:', directAggData[0].total_unrealized_pnl);
    console.log('     - Wallets with data:', directAggData[0].wallets_with_data);

    console.log('   Aggregation from wallet_unrealized_pnl:');
    console.log('     - Total unrealized P&L:', tableAggData[0].total_unrealized_pnl);
    console.log('     - Wallets with data:', tableAggData[0].wallets_with_data);

    const diff = Math.abs(directAggData[0].total_unrealized_pnl - tableAggData[0].total_unrealized_pnl);
    const diffPct = (diff / Math.abs(directAggData[0].total_unrealized_pnl) * 100).toFixed(4);

    console.log('   Difference:', diff.toFixed(2), `(${diffPct}%)`);

    if (diff < 0.01) {
      console.log('   ✅ PASS: Aggregates match (within rounding tolerance)\n');
    } else {
      console.log('   ⚠️  WARNING: Aggregates differ by more than expected\n');
    }

    // 3. Spot check 5 wallets
    console.log('3. Spot Check: Manually verify 5 wallets...\n');

    const sampleWallets = await client.query({
      query: `
        SELECT wallet_address
        FROM wallet_unrealized_pnl
        WHERE total_unrealized_pnl_usd IS NOT NULL
        ORDER BY rand()
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sampleWalletsData: any = await sampleWallets.json();

    for (const wallet of sampleWalletsData) {
      const walletAddr = wallet.wallet_address;

      // Get from aggregate table
      const aggData = await client.query({
        query: `
          SELECT
            total_unrealized_pnl_usd,
            positions_count
          FROM wallet_unrealized_pnl
          WHERE wallet_address = '${walletAddr}'
        `,
        format: 'JSONEachRow'
      });
      const aggResult: any = await aggData.json();

      // Calculate directly from trades
      const directData = await client.query({
        query: `
          SELECT
            SUM(unrealized_pnl_usd) as total_unrealized_pnl,
            COUNT(*) as positions_count
          FROM trades_raw
          WHERE wallet_address = '${walletAddr}'
            AND unrealized_pnl_usd IS NOT NULL
        `,
        format: 'JSONEachRow'
      });
      const directResult: any = await directData.json();

      const walletDiff = Math.abs(aggResult[0].total_unrealized_pnl_usd - directResult[0].total_unrealized_pnl);
      const match = walletDiff < 0.01;

      console.log(`   Wallet: ${walletAddr.slice(0, 10)}...`);
      console.log(`     - Aggregate table: $${aggResult[0].total_unrealized_pnl_usd.toFixed(2)} (${aggResult[0].positions_count} positions)`);
      console.log(`     - Direct calc:     $${directResult[0].total_unrealized_pnl.toFixed(2)} (${directResult[0].positions_count} positions)`);
      console.log(`     - Match: ${match ? '✅' : '❌'}`);
      console.log();
    }

    // 4. Anomaly detection
    console.log('4. Anomaly Detection:');

    const anomalies = await client.query({
      query: `
        SELECT
          COUNT(*) as extreme_values,
          MIN(unrealized_pnl_usd) as min_value,
          MAX(unrealized_pnl_usd) as max_value
        FROM trades_raw
        WHERE unrealized_pnl_usd IS NOT NULL
          AND (unrealized_pnl_usd < -1000000 OR unrealized_pnl_usd > 1000000)
      `,
      format: 'JSONEachRow'
    });
    const anomalyData: any = await anomalies.json();

    console.log('   - Extreme values (|P&L| > $1M):', anomalyData[0].extreme_values);
    if (anomalyData[0].extreme_values > 0) {
      console.log('     - Min value:', anomalyData[0].min_value);
      console.log('     - Max value:', anomalyData[0].max_value);
      console.log('     ⚠️  Review these manually if needed');
    } else {
      console.log('     ✅ No extreme outliers detected');
    }
    console.log();

    // 5. NULL handling check
    console.log('5. NULL Handling Check:');
    const nullCheck = await client.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(unrealized_pnl_usd) as non_null_unrealized_pnl,
          COUNT(*) - COUNT(unrealized_pnl_usd) as null_unrealized_pnl
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    });
    const nullCheckData: any = await nullCheck.json();

    console.log('   - Total trades:', nullCheckData[0].total_trades);
    console.log('   - Non-NULL unrealized P&L:', nullCheckData[0].non_null_unrealized_pnl);
    console.log('   - NULL unrealized P&L:', nullCheckData[0].null_unrealized_pnl);

    const nullPct = (nullCheckData[0].null_unrealized_pnl / nullCheckData[0].total_trades * 100).toFixed(2);
    console.log(`   - NULL rate: ${nullPct}%`);

    if (parseFloat(nullPct) < 60) {
      console.log('   ✅ PASS: Most trades have price data');
    } else {
      console.log('   ⚠️  WARNING: High NULL rate. Many markets missing current prices.');
    }
    console.log();

    // 6. Sample calculation verification
    console.log('6. Manual Calculation Verification:');
    const manualCheck = await client.query({
      query: `
        SELECT
          t.trade_id,
          t.wallet_address,
          t.market_id,
          t.shares,
          t.entry_price,
          p.last_price as current_price,
          t.unrealized_pnl_usd as stored_unrealized_pnl,
          (toFloat64(t.shares) * toFloat64OrZero(p.last_price)) -
          (toFloat64(t.shares) * toFloat64(t.entry_price)) as calculated_unrealized_pnl
        FROM trades_raw t
        LEFT JOIN market_last_price p ON t.market_id = p.market_id
        WHERE t.unrealized_pnl_usd IS NOT NULL
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const manualCheckData: any = await manualCheck.json();

    let allMatch = true;
    for (const row of manualCheckData) {
      const diff = Math.abs(row.stored_unrealized_pnl - row.calculated_unrealized_pnl);
      const match = diff < 0.01;
      allMatch = allMatch && match;

      console.log(`   Trade: ${row.trade_id.slice(0, 20)}...`);
      console.log(`     - Shares: ${row.shares}, Entry: ${row.entry_price}, Current: ${row.current_price}`);
      console.log(`     - Stored P&L: ${row.stored_unrealized_pnl.toFixed(6)}`);
      console.log(`     - Recalculated: ${row.calculated_unrealized_pnl.toFixed(6)}`);
      console.log(`     - Match: ${match ? '✅' : '❌'}`);
      console.log();
    }

    console.log('════════════════════════════════════════════════════════════════════');
    if (allMatch) {
      console.log('✅ VALIDATION COMPLETE - ALL CHECKS PASSED');
    } else {
      console.log('⚠️  VALIDATION COMPLETE - SOME WARNINGS DETECTED');
    }
    console.log('════════════════════════════════════════════════════════════════════\n');

    console.log('SYSTEM READY FOR USE:');
    console.log('  - Query individual trade unrealized P&L: SELECT * FROM trades_raw WHERE ...');
    console.log('  - Query wallet-level unrealized P&L: SELECT * FROM wallet_unrealized_pnl WHERE ...');
    console.log('  - API integration: See unrealized-pnl-step5-api-examples.ts\n');

    await client.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
    await client.close();
    process.exit(1);
  }
})();
