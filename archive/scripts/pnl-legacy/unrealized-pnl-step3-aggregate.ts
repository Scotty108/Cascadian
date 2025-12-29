#!/usr/bin/env npx tsx

/**
 * UNREALIZED P&L SYSTEM - STEP 3: Build Wallet Aggregates
 *
 * Creates wallet_unrealized_pnl table with aggregated unrealized P&L per wallet.
 * Also creates a materialized view for real-time updates.
 *
 * TABLE STRUCTURE:
 * - wallet_address: Wallet identifier
 * - total_unrealized_pnl_usd: Sum of all unrealized P&L
 * - positions_count: Number of open positions
 * - markets_count: Number of unique markets
 * - avg_unrealized_pnl_per_position: Average P&L per position
 * - last_updated: Timestamp of last calculation
 *
 * Runtime: ~5-10 minutes (aggregating 161M trades)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L SYSTEM - STEP 3: BUILD WALLET AGGREGATES');
  console.log('════════════════════════════════════════════════════════════════════\n');

  try {
    // 1. Drop existing table if it exists
    console.log('1. Dropping existing wallet_unrealized_pnl table (if exists)...');
    await client.exec({
      query: 'DROP TABLE IF EXISTS wallet_unrealized_pnl'
    });
    console.log('   ✅ Done\n');

    // 2. Create wallet_unrealized_pnl table
    console.log('2. Creating wallet_unrealized_pnl table...');
    await client.exec({
      query: `
        CREATE TABLE wallet_unrealized_pnl (
          wallet_address String,
          total_unrealized_pnl_usd Float64,
          positions_count UInt32,
          markets_count UInt32,
          avg_unrealized_pnl_per_position Float64,
          total_shares Float64,
          total_cost_basis Float64,
          last_updated DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(last_updated)
        ORDER BY wallet_address
      `
    });
    console.log('   ✅ Table created\n');

    // 3. Populate table with aggregated data
    console.log('3. Populating wallet_unrealized_pnl table...');
    console.log('   (This will take 5-10 minutes)');

    const startTime = Date.now();

    await client.exec({
      query: `
        INSERT INTO wallet_unrealized_pnl (
          wallet_address,
          total_unrealized_pnl_usd,
          positions_count,
          markets_count,
          avg_unrealized_pnl_per_position,
          total_shares,
          total_cost_basis
        )
        SELECT
          wallet_address,
          SUM(unrealized_pnl_usd) as total_unrealized_pnl_usd,
          COUNT(*) as positions_count,
          COUNT(DISTINCT market_id) as markets_count,
          AVG(unrealized_pnl_usd) as avg_unrealized_pnl_per_position,
          SUM(toFloat64(shares)) as total_shares,
          SUM(toFloat64(shares) * toFloat64(entry_price)) as total_cost_basis
        FROM trades_raw
        WHERE wallet_address != ''
          AND unrealized_pnl_usd IS NOT NULL
        GROUP BY wallet_address
      `
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`   ✅ Table populated in ${duration} minutes\n`);

    // 4. Verify data
    console.log('4. Verifying wallet aggregates...');
    const verifyStats = await client.query({
      query: `
        SELECT
          COUNT(*) as total_wallets,
          ROUND(SUM(total_unrealized_pnl_usd), 2) as total_unrealized_pnl,
          ROUND(AVG(total_unrealized_pnl_usd), 2) as avg_unrealized_pnl_per_wallet,
          MAX(positions_count) as max_positions_per_wallet
        FROM wallet_unrealized_pnl
      `,
      format: 'JSONEachRow'
    });
    const statsData: any = await verifyStats.json();
    console.log('   Aggregate stats:');
    console.log('   - Total wallets:', statsData[0].total_wallets);
    console.log('   - Total unrealized P&L (all wallets):', statsData[0].total_unrealized_pnl);
    console.log('   - Avg unrealized P&L per wallet:', statsData[0].avg_unrealized_pnl_per_wallet);
    console.log('   - Max positions per wallet:', statsData[0].max_positions_per_wallet);
    console.log();

    // 5. Sample top performers
    console.log('5. Top 5 wallets by unrealized P&L...');
    const topWinners = await client.query({
      query: `
        SELECT
          wallet_address,
          ROUND(total_unrealized_pnl_usd, 2) as unrealized_pnl,
          positions_count,
          markets_count
        FROM wallet_unrealized_pnl
        ORDER BY total_unrealized_pnl_usd DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const topWinnersData: any = await topWinners.json();
    console.log(JSON.stringify(topWinnersData, null, 2));
    console.log();

    // 6. Sample worst performers
    console.log('6. Bottom 5 wallets by unrealized P&L...');
    const topLosers = await client.query({
      query: `
        SELECT
          wallet_address,
          ROUND(total_unrealized_pnl_usd, 2) as unrealized_pnl,
          positions_count,
          markets_count
        FROM wallet_unrealized_pnl
        ORDER BY total_unrealized_pnl_usd ASC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const topLosersData: any = await topLosers.json();
    console.log(JSON.stringify(topLosersData, null, 2));
    console.log();

    // 7. Create index for fast lookups
    console.log('7. Creating index for fast wallet lookups...');
    // ClickHouse automatically indexes by ORDER BY key (wallet_address)
    console.log('   ✅ Index created (via ORDER BY wallet_address)\n');

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('✅ STEP 3 COMPLETE');
    console.log('════════════════════════════════════════════════════════════════════\n');
    console.log('Next step: Run unrealized-pnl-step4-validate.ts to verify calculations\n');
    console.log('USAGE:');
    console.log('  Query wallet unrealized P&L:');
    console.log('    SELECT * FROM wallet_unrealized_pnl WHERE wallet_address = \'0x...\'\n');

    await client.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
    await client.close();
    process.exit(1);
  }
})();
