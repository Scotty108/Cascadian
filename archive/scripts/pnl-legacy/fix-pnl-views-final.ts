#!/usr/bin/env tsx
/**
 * Fix P&L Views - FINAL (Correct Join Logic)
 *
 * ROOT CAUSE: Was joining through token_condition_market_map → vw_resolutions_truth
 * FIX: Join market_cid directly to market_resolutions_final.condition_id_norm
 *
 * This matches the working pattern from trace-wallet-data.ts
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

async function fixViews() {
  console.log('================================================================================');
  console.log('🔧 FIXING P&L VIEWS - FINAL (Correct Join Logic)');
  console.log('================================================================================\n');

  // Step 1: Update vw_trading_pnl_positions with direct join to market_resolutions_final
  console.log('1️⃣ Updating vw_trading_pnl_positions with correct join...');
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
        resolved_markets AS (
          SELECT DISTINCT condition_id_norm
          FROM default.market_resolutions_final
          WHERE length(payout_numerators) > 0
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
          replaceAll(pos.market_cid, '0x', '') IN (SELECT condition_id_norm FROM resolved_markets),
          'CLOSED',
          'OPEN'
        ) AS status
      FROM pos
    `,
  });
  console.log('   ✅ vw_trading_pnl_positions updated');

  // Step 2: Verify position status
  console.log('\n2️⃣ Verifying position status for wallet...');
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
    console.log(`   ${row.status}: ${row.count} positions`);
  });

  // Step 3: Check realized P&L
  console.log('\n3️⃣ Checking vw_trading_pnl_realized...');
  try {
    const realizedQuery = await ch.query({
      query: `
        SELECT
          count() as closed_positions,
          sum(realized_pnl_usd) as total_pnl
        FROM cascadian_clean.vw_trading_pnl_realized
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const realizedData = await realizedQuery.json<any>();
    console.log(`   Closed positions: ${realizedData[0].closed_positions}`);
    console.log(`   Total realized P&L: $${realizedData[0].total_pnl}`);
  } catch (e: any) {
    console.log(`   ⚠️  View may need update: ${e.message.substring(0, 100)}`);
  }

  // Step 4: Check vw_wallet_pnl_unified
  console.log('\n4️⃣ Checking vw_wallet_pnl_unified...');
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
      console.log('   ✅ Wallet found:');
      console.log(`      Trading Realized: $${w.trading_realized_pnl}`);
      console.log(`      Redemption: $${w.redemption_pnl || 0}`);
      console.log(`      Unrealized: $${w.unrealized_pnl || 0}`);
      console.log(`      Total: $${w.total_pnl}`);
      console.log(`      Closed: ${w.closed_positions}, Open: ${w.open_positions}`);

      const matchPct = (w.total_pnl / 332563) * 100;
      console.log(`\n   📊 Match vs Polymarket ($332,563): ${matchPct.toFixed(1)}%`);

      if (matchPct >= 90) {
        console.log('   ✅ SUCCESS!');
      } else if (w.closed_positions >= 20) {
        console.log(`   🟡 PROGRESS: ${w.closed_positions} closed positions now visible`);
      }
    } else {
      console.log('   ⚠️  Wallet not found');
    }
  } catch (e: any) {
    console.log(`   ⚠️  View may need update: ${e.message.substring(0, 100)}`);
  }

  console.log('\n================================================================================');
  console.log('✅ VIEWS UPDATED');
  console.log('================================================================================');

  await ch.close();
}

fixViews().catch(console.error);
