#!/usr/bin/env tsx
/**
 * Fix P&L Views - Use the WORKING Join Path
 *
 * CONTEXT:
 * - vw_positions_open already uses: token_condition_market_map → vw_resolutions_truth ✅
 * - P&L views still use: market_resolutions_final (broken) ❌
 *
 * FIX:
 * Update P&L views to use the same join path as vw_positions_open
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 180000,
});

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function fixPnLViews() {
  console.log('================================================================================');
  console.log('🔧 FIXING P&L VIEWS - USING WORKING JOIN PATH');
  console.log('================================================================================\n');

  console.log('Context:');
  console.log('  - vw_positions_open uses: token_condition_market_map → vw_resolutions_truth ✅');
  console.log('  - Shows 0 open positions correctly');
  console.log('  - P&L views need to use the same join\n');

  // Step 1: Update vw_trading_pnl_positions
  console.log('1️⃣ Updating vw_trading_pnl_positions...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_positions AS
      WITH
        pos AS (
          SELECT
            wallet,
            market_cid,
            outcome,
            sum(d_shares) AS position_shares,
            sum(d_cash) AS net_cash,
            sum(fee_usd) AS total_fees_usd
          FROM cascadian_clean.vw_trades_ledger
          GROUP BY wallet, market_cid, outcome
        ),
        market_conditions AS (
          SELECT
            market_id_cid AS market_cid,
            any(lower(condition_id_32b)) AS condition_id_32b
          FROM cascadian_clean.token_condition_market_map
          GROUP BY market_id_cid
        )
      SELECT
        pos.wallet,
        pos.market_cid,
        pos.outcome,
        pos.position_shares,
        pos.net_cash,
        pos.total_fees_usd,
        if(
          abs(pos.position_shares) < 0.01 OR
          (mc.condition_id_32b IS NOT NULL AND r.condition_id_32b IS NOT NULL),
          'CLOSED',
          'OPEN'
        ) AS status
      FROM pos
      LEFT JOIN market_conditions AS mc ON mc.market_cid = pos.market_cid
      LEFT JOIN cascadian_clean.vw_resolutions_truth AS r ON r.condition_id_32b = mc.condition_id_32b
    `,
  });
  console.log('   ✅ Updated to use token_condition_market_map → vw_resolutions_truth');

  // Step 2: Verify position status
  console.log('\n2️⃣ Verifying position status...');
  const statusCheck = await ch.query({
    query: `
      SELECT
        status,
        count() as count
      FROM cascadian_clean.vw_trading_pnl_positions
      WHERE lower(wallet) = lower('${TEST_WALLET}')
      GROUP BY status
    `,
    format: 'JSONEachRow',
  });
  const statusData = await statusCheck.json<any>();
  statusData.forEach((row: any) => {
    console.log(`   ${row.status}: ${row.count} positions`);
  });

  // Step 3: Check vw_trading_pnl_realized
  console.log('\n3️⃣ Checking vw_trading_pnl_realized...');
  try {
    const realizedQuery = await ch.query({
      query: `
        SELECT
          count() as closed_count,
          sum(realized_pnl_usd) as total_pnl
        FROM cascadian_clean.vw_trading_pnl_realized
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const realizedData = await realizedQuery.json<any>();
    console.log(`   Closed positions: ${realizedData[0].closed_count}`);
    console.log(`   Trading realized P&L: $${realizedData[0].total_pnl}`);
  } catch (e: any) {
    console.log(`   ⚠️  ${e.message.substring(0, 100)}`);
  }

  // Step 4: Check vw_redemption_pnl
  console.log('\n4️⃣ Checking vw_redemption_pnl...');
  try {
    const redemptionQuery = await ch.query({
      query: `
        SELECT
          count() as position_count,
          sum(redemption_pnl_usd) as total_redemption
        FROM cascadian_clean.vw_redemption_pnl
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const redemptionData = await redemptionQuery.json<any>();
    console.log(`   Redeemed positions: ${redemptionData[0].position_count}`);
    console.log(`   Redemption P&L: $${redemptionData[0].total_redemption}`);
  } catch (e: any) {
    console.log(`   ⚠️  ${e.message.substring(0, 100)}`);
  }

  // Step 5: Check vw_wallet_pnl_unified
  console.log('\n5️⃣ Checking vw_wallet_pnl_unified...');
  try {
    const unifiedQuery = await ch.query({
      query: `
        SELECT *
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const unifiedData = await unifiedQuery.json<any>();
    if (unifiedData.length > 0) {
      const w = unifiedData[0];
      console.log('   ✅ Wallet P&L:');
      console.log(`      Trading Realized: $${w.trading_realized_pnl}`);
      console.log(`      Redemption: $${w.redemption_pnl || 0}`);
      console.log(`      Unrealized: $${w.unrealized_pnl || 0}`);
      console.log(`      Total: $${w.total_pnl}`);
      console.log(`      Closed: ${w.closed_positions}, Open: ${w.open_positions}`);
    } else {
      console.log('   ⚠️  Wallet not found');
    }
  } catch (e: any) {
    console.log(`   ⚠️  ${e.message.substring(0, 100)}`);
  }

  console.log('\n================================================================================');
  console.log('✅ VIEWS UPDATED');
  console.log('================================================================================');
  console.log('\nNOTE: We only have 31 markets for this wallet in ClickHouse (Jun-Nov 2024)');
  console.log('Polymarket shows 2,816 predictions total.');
  console.log('Next step: Run API backfill to import the missing 2,785 markets');

  await ch.close();
}

fixPnLViews().catch(console.error);
