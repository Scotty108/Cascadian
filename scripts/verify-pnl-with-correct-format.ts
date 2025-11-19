#!/usr/bin/env tsx
/**
 * Verify P&L Calculation with Correct Wallet Format
 *
 * Key Discovery: Database stores wallets WITH 0x prefix
 * This script calculates P&L using correct format to verify data exists
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad'; // WITH 0x prefix

async function verifyPnL() {
  console.log('================================================================================');
  console.log('🔍 VERIFYING P&L WITH CORRECT WALLET FORMAT');
  console.log('================================================================================\n');

  console.log(`Wallet: ${TEST_WALLET}`);
  console.log('Expected P&L: ~$332,563 (per Polymarket)\n');

  // Step 1: Verify trades exist with correct format
  console.log('1️⃣ Verifying trades exist in vw_trades_ledger...');
  const tradesCheck = await ch.query({
    query: `
      SELECT
        count() as trade_count,
        count(DISTINCT market_cid) as unique_markets,
        sum(d_shares) as total_shares_delta,
        sum(d_cash) as total_cash_delta
      FROM cascadian_clean.vw_trades_ledger
      WHERE lower(wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const tradesData = await tradesCheck.json<any>();
  console.log(`   Trades: ${tradesData[0].trade_count}`);
  console.log(`   Unique markets: ${tradesData[0].unique_markets}`);
  console.log(`   Net shares: ${tradesData[0].total_shares_delta}`);
  console.log(`   Net cash: $${tradesData[0].total_cash_delta}`);

  // Step 2: Check position status breakdown
  console.log('\n2️⃣ Checking position status breakdown...');
  const statusCheck = await ch.query({
    query: `
      SELECT
        status,
        count() as count,
        sum(abs(position_shares)) as total_shares
      FROM cascadian_clean.vw_trading_pnl_positions
      WHERE lower(wallet) = lower('${TEST_WALLET}')
      GROUP BY status
    `,
    format: 'JSONEachRow',
  });
  const statusData = await statusCheck.json<any>();
  statusData.forEach((row: any) => {
    console.log(`   ${row.status}: ${row.count} positions, ${row.total_shares} shares`);
  });

  // Step 3: Calculate realized P&L from closed positions
  console.log('\n3️⃣ Calculating realized P&L from closed positions...');
  const realizedCheck = await ch.query({
    query: `
      SELECT
        count() as closed_positions,
        sum(realized_pnl_usd) as total_realized_pnl
      FROM cascadian_clean.vw_trading_pnl_realized
      WHERE lower(wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const realizedData = await realizedCheck.json<any>();
  console.log(`   Closed positions: ${realizedData[0].closed_positions}`);
  console.log(`   Total realized P&L: $${realizedData[0].total_realized_pnl}`);

  // Step 4: Check vw_wallet_pnl_unified
  console.log('\n4️⃣ Checking vw_wallet_pnl_unified...');
  try {
    const walletPnL = await ch.query({
      query: `
        SELECT *
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const walletData = await walletPnL.json<any>();

    if (walletData.length > 0) {
      const w = walletData[0];
      console.log('   ✅ Wallet found in unified view:');
      console.log(`      Trading Realized: $${w.trading_realized_pnl}`);
      console.log(`      Redemption: $${w.redemption_pnl || 0}`);
      console.log(`      Unrealized: $${w.unrealized_pnl || 0}`);
      console.log(`      Total P&L: $${w.total_pnl}`);
      console.log(`      Closed positions: ${w.closed_positions}`);
      console.log(`      Open positions: ${w.open_positions}`);

      const matchPct = (w.total_pnl / 332563) * 100;
      console.log(`\n   📊 Match vs Polymarket: ${matchPct.toFixed(1)}%`);

      if (matchPct >= 90) {
        console.log('   ✅ SUCCESS: P&L matches within tolerance!');
      } else if (w.closed_positions > 0) {
        console.log(`   🟡 PARTIAL: ${w.closed_positions} closed positions now visible`);
        console.log(`   Gap: $${(332563 - w.total_pnl).toFixed(2)}`);
      } else {
        console.log('   ❌ ISSUE: Still showing 0 or very low P&L');
      }
    } else {
      console.log('   ⚠️  Wallet not found in unified view');
    }
  } catch (e: any) {
    console.log(`   ❌ Error querying unified view: ${e.message}`);
  }

  // Step 5: Manual P&L calculation for comparison
  console.log('\n5️⃣ Manual P&L calculation (trades + resolutions)...');
  try {
    const manualPnL = await ch.query({
      query: `
        WITH pos AS (
          SELECT
            wallet,
            market_cid,
            outcome,
            sum(d_shares) AS net_shares,
            sum(d_cash) AS net_cash
          FROM cascadian_clean.vw_trades_ledger
          WHERE lower(wallet) = lower('${TEST_WALLET}')
          GROUP BY wallet, market_cid, outcome
        ),
        market_conditions AS (
          SELECT
            market_id_cid AS market_cid,
            any(condition_id_32b) AS condition_id_32b
          FROM cascadian_clean.token_condition_market_map
          GROUP BY market_id_cid
        )
        SELECT
          count() as positions_with_resolution,
          sum((p.net_shares * arrayElement(r.payout_numerators, p.outcome + 1) / r.payout_denominator) + p.net_cash) AS calculated_pnl
        FROM pos p
        INNER JOIN market_conditions mc ON mc.market_cid = p.market_cid
        INNER JOIN cascadian_clean.vw_resolutions_truth r ON r.condition_id_32b = mc.condition_id_32b
        WHERE abs(p.net_shares) >= 0.01
      `,
      format: 'JSONEachRow',
    });
    const manualData = await manualPnL.json<any>();
    console.log(`   Positions with resolutions: ${manualData[0].positions_with_resolution}`);
    console.log(`   Calculated P&L: $${manualData[0].calculated_pnl}`);

    const matchPct = (parseFloat(manualData[0].calculated_pnl) / 332563) * 100;
    console.log(`   Match vs Polymarket: ${matchPct.toFixed(1)}%`);
  } catch (e: any) {
    console.log(`   ❌ Manual calculation failed: ${e.message}`);
  }

  console.log('\n================================================================================');
  console.log('✅ VERIFICATION COMPLETE');
  console.log('================================================================================');

  await ch.close();
}

verifyPnL().catch(console.error);
