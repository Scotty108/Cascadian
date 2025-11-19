#!/usr/bin/env tsx
/**
 * Fix Position Status Bug - Root Cause of $332K P&L Discrepancy
 *
 * PROBLEM:
 * vw_trading_pnl_positions marks position as CLOSED only when shares go to ~zero.
 * This misses positions where:
 * - Wallet sold most shares but not all (e.g., 900 of 1000)
 * - Market resolves
 * - Remaining shares redeem for payout
 * - Polymarket shows as CLOSED with full trading P&L
 * - Our system shows as OPEN, so trading_realized_pnl = $0
 *
 * SOLUTION:
 * Mark positions as CLOSED if:
 * 1. Shares went to zero (original logic), OR
 * 2. Market has resolved (new logic)
 *
 * EXPECTED OUTCOME:
 * - Wallet 0x4ce7: 0 closed positions → 48+ closed positions
 * - Trading P&L: $0 → ~$332K
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

async function fixPositionStatus() {
  console.log('================================================================================');
  console.log('🔧 FIXING POSITION STATUS BUG');
  console.log('================================================================================\n');

  // Step 1: Check current state for wallet 0x4ce7
  console.log('1️⃣ BEFORE FIX - Wallet 0x4ce7 current state:');
  const beforeWallet = await ch.query({
    query: `
      SELECT
        wallet,
        trading_realized_pnl,
        redemption_pnl,
        unrealized_pnl,
        total_pnl,
        closed_positions,
        open_positions,
        redeemed_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow',
  });
  const beforeData = await beforeWallet.json<any>();

  if (beforeData.length > 0) {
    const b = beforeData[0];
    console.log(`   Trading Realized P&L: $${b.trading_realized_pnl.toFixed(2)}`);
    console.log(`   Redemption P&L: $${b.redemption_pnl.toFixed(2)}`);
    console.log(`   Unrealized P&L: $${b.unrealized_pnl.toFixed(2)}`);
    console.log(`   Total P&L: $${b.total_pnl.toFixed(2)}`);
    console.log(`   Closed positions: ${b.closed_positions}`);
    console.log(`   Open positions: ${b.open_positions}`);
    console.log(`   Redeemed positions: ${b.redeemed_positions}`);
  } else {
    console.log('   ❌ Wallet not found in vw_wallet_pnl_unified');
  }

  // Step 2: Count how many positions should be marked as CLOSED
  console.log('\n2️⃣ Analyzing positions that should be CLOSED:');
  const shouldBeClosed = await ch.query({
    query: `
      WITH pos AS (
        SELECT
          wallet,
          market_cid,
          outcome,
          sum(d_shares) AS position_shares,
          if(abs(sum(d_shares)) < 0.01, 'CLOSED_ZERO', 'OPEN') AS current_status
        FROM cascadian_clean.vw_trades_ledger
        GROUP BY wallet, market_cid, outcome
      )
      SELECT
        countIf(current_status = 'CLOSED_ZERO') as closed_by_zero_shares,
        countIf(
          current_status != 'CLOSED_ZERO' AND
          market_cid IN (
            SELECT concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00')
            FROM default.market_resolutions_final
            WHERE length(payout_numerators) > 0
          )
        ) as should_close_by_resolution,
        countIf(current_status != 'CLOSED_ZERO') as currently_open
      FROM pos
      WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow',
  });
  const analysisData = await shouldBeClosed.json<any>();
  const a = analysisData[0];

  console.log(`   Currently closed (shares = 0): ${a.closed_by_zero_shares}`);
  console.log(`   Should close (market resolved): ${a.should_close_by_resolution}`);
  console.log(`   Total that will be closed after fix: ${parseInt(a.closed_by_zero_shares) + parseInt(a.should_close_by_resolution)}`);

  // Step 3: Apply the fix
  console.log('\n3️⃣ Applying fix to vw_trading_pnl_positions:');

  // First, get the current vw_trades_ledger definition to understand the source
  console.log('   Getting vw_trades_ledger schema...');
  const ledgerSchema = await ch.query({
    query: `DESCRIBE TABLE cascadian_clean.vw_trades_ledger`,
    format: 'JSONEachRow',
  });
  const ledgerCols = await ledgerSchema.json<any>();
  console.log(`   Found ${ledgerCols.length} columns in vw_trades_ledger`);

  // Create updated view with new CLOSED logic
  console.log('\n   Creating updated view definition...');

  const newViewSQL = `
    CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_positions
    (
        wallet String,
        market_cid String,
        outcome Int32,
        position_shares Float64,
        net_cash Float64,
        total_fees_usd Float64,
        status String
    )
    AS
    WITH pos AS (
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
      SELECT DISTINCT concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00') AS market_cid
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
        pos.market_cid IN (SELECT market_cid FROM resolved_markets),
        'CLOSED',
        'OPEN'
      ) AS status
    FROM pos
  `;

  await ch.command({ query: newViewSQL });
  console.log('   ✅ View updated successfully');

  // Step 4: Verify the fix
  console.log('\n4️⃣ AFTER FIX - Wallet 0x4ce7 new state:');
  const afterWallet = await ch.query({
    query: `
      SELECT
        wallet,
        trading_realized_pnl,
        redemption_pnl,
        unrealized_pnl,
        total_pnl,
        closed_positions,
        open_positions,
        redeemed_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow',
  });
  const afterData = await afterWallet.json<any>();

  if (afterData.length > 0) {
    const after = afterData[0];
    const before = beforeData[0];

    console.log(`   Trading Realized P&L: $${before.trading_realized_pnl.toFixed(2)} → $${after.trading_realized_pnl.toFixed(2)} (${after.trading_realized_pnl >= before.trading_realized_pnl ? '+' : ''}${(after.trading_realized_pnl - before.trading_realized_pnl).toFixed(2)})`);
    console.log(`   Redemption P&L: $${before.redemption_pnl.toFixed(2)} → $${after.redemption_pnl.toFixed(2)}`);
    console.log(`   Unrealized P&L: $${before.unrealized_pnl.toFixed(2)} → $${after.unrealized_pnl.toFixed(2)}`);
    console.log(`   Total P&L: $${before.total_pnl.toFixed(2)} → $${after.total_pnl.toFixed(2)} (${after.total_pnl >= before.total_pnl ? '+' : ''}${(after.total_pnl - before.total_pnl).toFixed(2)})`);
    console.log(`   Closed positions: ${before.closed_positions} → ${after.closed_positions} (+${after.closed_positions - before.closed_positions})`);
    console.log(`   Open positions: ${before.open_positions} → ${after.open_positions} (${after.open_positions - before.open_positions})`);

    console.log('\n📊 Comparison to Polymarket API:');
    console.log('   Polymarket shows: $332,563 realized P&L');
    console.log(`   Our system now shows: $${after.trading_realized_pnl.toFixed(2)} trading realized`);
    console.log(`   Difference: $${(332563 - after.trading_realized_pnl).toFixed(2)} (${((after.trading_realized_pnl / 332563) * 100).toFixed(1)}% match)`);

    if (after.closed_positions >= 40) {
      console.log('\n✅ SUCCESS: Wallet now shows 40+ closed positions (Polymarket shows 48+)');
    } else {
      console.log(`\n⚠️  WARNING: Expected 48+ closed positions, got ${after.closed_positions}`);
    }
  }

  console.log('\n================================================================================');
  console.log('✅ FIX APPLIED SUCCESSFULLY');
  console.log('================================================================================');

  await ch.close();
}

fixPositionStatus().catch(console.error);
