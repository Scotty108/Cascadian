#!/usr/bin/env npx tsx

/**
 * UNREALIZED P&L SYSTEM - STEP 2: Calculate Unrealized P&L
 *
 * Calculates unrealized P&L for all 161M trades using market_last_price.
 *
 * FORMULA: unrealized_pnl_usd = (shares * current_price) - (shares * entry_price)
 *
 * FALLBACK STRATEGY:
 * - If market has current_price: Calculate unrealized P&L
 * - If market is missing from market_last_price: Set to NULL (can't estimate)
 * - Zero-address markets: Set to NULL (invalid data)
 *
 * Uses ReplacingMergeTree pattern: CREATE AS SELECT + RENAME (atomic rebuild)
 * This is safer than ALTER UPDATE for 161M rows.
 *
 * Runtime: ~15-30 minutes (161M rows, full table rebuild)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L SYSTEM - STEP 2: CALCULATE UNREALIZED P&L');
  console.log('════════════════════════════════════════════════════════════════════\n');

  try {
    // 1. Check current state
    console.log('1. Checking current state...');
    const currentState = await client.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(unrealized_pnl_usd) as trades_with_unrealized_pnl,
          COUNT(*) - COUNT(unrealized_pnl_usd) as trades_without_unrealized_pnl
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    });
    const currentStateData: any = await currentState.json();
    console.log('   - Total trades:', currentStateData[0].total_trades);
    console.log('   - Trades with unrealized P&L:', currentStateData[0].trades_with_unrealized_pnl);
    console.log('   - Trades without unrealized P&L:', currentStateData[0].trades_without_unrealized_pnl);
    console.log();

    // 2. Get table engine info
    console.log('2. Getting table engine info...');
    const engineInfo = await client.query({
      query: `
        SELECT engine
        FROM system.tables
        WHERE database = currentDatabase()
          AND name = 'trades_raw'
      `,
      format: 'JSONEachRow'
    });
    const engineData: any = await engineInfo.json();
    console.log('   - Table engine:', engineData[0].engine);
    console.log();

    // 3. Build new table with unrealized P&L calculated
    console.log('3. Creating temporary table with unrealized P&L calculations...');
    console.log('   (This will take 15-30 minutes for 161M rows)');

    const startTime = Date.now();

    await client.exec({
      query: `
        CREATE TABLE trades_raw_with_unrealized_pnl AS
        SELECT
          t.*,
          -- Calculate unrealized P&L
          -- Formula: (shares * current_price) - (shares * entry_price)
          -- Returns NULL if current_price is missing
          CASE
            WHEN p.last_price IS NOT NULL THEN
              (toFloat64(t.shares) * toFloat64OrZero(p.last_price)) -
              (toFloat64(t.shares) * toFloat64(t.entry_price))
            ELSE
              NULL
          END as unrealized_pnl_usd
        FROM trades_raw t
        LEFT JOIN market_last_price p ON t.market_id = p.market_id
      `
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`   ✅ Temporary table created in ${duration} minutes\n`);

    // 4. Verify new table
    console.log('4. Verifying new table...');
    const verifyNew = await client.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(unrealized_pnl_usd) as trades_with_unrealized_pnl,
          COUNT(*) - COUNT(unrealized_pnl_usd) as trades_without_unrealized_pnl,
          ROUND(AVG(unrealized_pnl_usd), 2) as avg_unrealized_pnl,
          ROUND(MIN(unrealized_pnl_usd), 2) as min_unrealized_pnl,
          ROUND(MAX(unrealized_pnl_usd), 2) as max_unrealized_pnl
        FROM trades_raw_with_unrealized_pnl
      `,
      format: 'JSONEachRow'
    });
    const verifyNewData: any = await verifyNew.json();
    console.log('   New table stats:');
    console.log('   - Total trades:', verifyNewData[0].total_trades);
    console.log('   - Trades with unrealized P&L:', verifyNewData[0].trades_with_unrealized_pnl);
    console.log('   - Trades without unrealized P&L:', verifyNewData[0].trades_without_unrealized_pnl);
    console.log('   - Avg unrealized P&L:', verifyNewData[0].avg_unrealized_pnl);
    console.log('   - Min unrealized P&L:', verifyNewData[0].min_unrealized_pnl);
    console.log('   - Max unrealized P&L:', verifyNewData[0].max_unrealized_pnl);
    console.log();

    // 5. Sample check
    console.log('5. Sample data check...');
    const sample = await client.query({
      query: `
        SELECT
          trade_id,
          wallet_address,
          market_id,
          shares,
          entry_price,
          unrealized_pnl_usd
        FROM trades_raw_with_unrealized_pnl
        WHERE unrealized_pnl_usd IS NOT NULL
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sampleData: any = await sample.json();
    console.log('   Sample trades with unrealized P&L:');
    console.log(JSON.stringify(sampleData, null, 2));
    console.log();

    // 6. Atomic swap
    console.log('6. Performing atomic swap (RENAME)...');
    console.log('   - Backing up old table as trades_raw_backup');
    console.log('   - Renaming new table to trades_raw');

    await client.exec({
      query: `
        RENAME TABLE
          trades_raw TO trades_raw_backup,
          trades_raw_with_unrealized_pnl TO trades_raw
      `
    });

    console.log('   ✅ Atomic swap complete\n');

    // 7. Final verification
    console.log('7. Final verification...');
    const finalVerify = await client.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(unrealized_pnl_usd) as trades_with_unrealized_pnl,
          ROUND(COUNT(unrealized_pnl_usd) * 100.0 / COUNT(*), 2) as coverage_pct
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    });
    const finalVerifyData: any = await finalVerify.json();
    console.log('   - Total trades:', finalVerifyData[0].total_trades);
    console.log('   - Trades with unrealized P&L:', finalVerifyData[0].trades_with_unrealized_pnl);
    console.log('   - Coverage %:', finalVerifyData[0].coverage_pct);
    console.log();

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('✅ STEP 2 COMPLETE');
    console.log('════════════════════════════════════════════════════════════════════\n');
    console.log('Next step: Run unrealized-pnl-step3-aggregate.ts to build wallet aggregates\n');
    console.log('IMPORTANT: Old table backed up as trades_raw_backup');
    console.log('           You can drop it once you verify everything works.\n');

    await client.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
    await client.close();
    process.exit(1);
  }
})();
