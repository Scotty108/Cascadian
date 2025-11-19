#!/usr/bin/env tsx
/**
 * Fix Position Status Bug - V2 (Correct Join Logic)
 *
 * ISSUE WITH V1: Used wrong join logic for matching markets to resolutions
 * FIX: Direct match on market_cid = condition_id_norm (both stripped of 0x)
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
  console.log('🔧 FIXING POSITION STATUS BUG - V2');
  console.log('================================================================================\n');

  // Step 1: Check current state
  console.log('1️⃣ BEFORE FIX - Wallet 0x4ce7:');
  const beforeWallet = await ch.query({
    query: `
      SELECT
        wallet,
        trading_realized_pnl,
        total_pnl,
        closed_positions,
        open_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow',
  });
  const beforeData = await beforeWallet.json<any>();
  const before = beforeData[0];

  console.log(`   Trading Realized P&L: $${before.trading_realized_pnl.toFixed(2)}`);
  console.log(`   Total P&L: $${before.total_pnl.toFixed(2)}`);
  console.log(`   Closed positions: ${before.closed_positions}`);
  console.log(`   Open positions: ${before.open_positions}`);

  // Step 2: Apply corrected fix
  console.log('\n2️⃣ Applying corrected fix...');

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
        replaceAll(pos.market_cid, '0x', '') IN (
          SELECT replaceAll(condition_id_norm, '0x', '') FROM resolved_markets
        ),
        'CLOSED',
        'OPEN'
      ) AS status
    FROM pos
  `;

  await ch.command({ query: newViewSQL });
  console.log('   ✅ View updated with corrected join logic');

  // Step 3: Verify
  console.log('\n3️⃣ AFTER FIX - Wallet 0x4ce7:');
  const afterWallet = await ch.query({
    query: `
      SELECT
        wallet,
        trading_realized_pnl,
        total_pnl,
        closed_positions,
        open_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow',
  });
  const afterData = await afterWallet.json<any>();
  const after = afterData[0];

  console.log(`   Trading Realized P&L: $${before.trading_realized_pnl.toFixed(2)} → $${after.trading_realized_pnl.toFixed(2)} (${after.trading_realized_pnl >= 0 ? '+' : ''}$${(after.trading_realized_pnl - before.trading_realized_pnl).toFixed(2)})`);
  console.log(`   Total P&L: $${before.total_pnl.toFixed(2)} → $${after.total_pnl.toFixed(2)} (${after.total_pnl >= before.total_pnl ? '+' : ''}$${(after.total_pnl - before.total_pnl).toFixed(2)})`);
  console.log(`   Closed positions: ${before.closed_positions} → ${after.closed_positions} (+${after.closed_positions - before.closed_positions})`);
  console.log(`   Open positions: ${before.open_positions} → ${after.open_positions} (${after.open_positions - before.open_positions})`);

  console.log('\n📊 Comparison to Polymarket:');
  console.log(`   Polymarket: $332,563 realized P&L, 48+ closed positions`);
  console.log(`   Our system: $${after.trading_realized_pnl.toFixed(2)} realized P&L, ${after.closed_positions} closed positions`);
  const matchPct = (after.trading_realized_pnl / 332563) * 100;
  console.log(`   Match rate: ${matchPct.toFixed(1)}%`);

  if (matchPct >= 90) {
    console.log('\n✅ SUCCESS: P&L now matches Polymarket within tolerance!');
  } else if (after.closed_positions >= 25) {
    console.log(`\n🟡 PROGRESS: ${after.closed_positions} closed positions now visible (was 0)`);
    console.log('   This proves the fix is working. Remaining gap may be due to:');
    console.log('   1. FIFO vs close-to-zero methodology differences');
    console.log('   2. Different P&L calculation formulas');
  } else {
    console.log('\n⚠️  WARNING: Expected significant improvement');
  }

  console.log('\n================================================================================');
  console.log('✅ FIX APPLIED');
  console.log('================================================================================');

  await ch.close();
}

fixPositionStatus().catch(console.error);
