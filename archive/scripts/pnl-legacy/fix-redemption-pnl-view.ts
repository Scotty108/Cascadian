#!/usr/bin/env tsx
/**
 * Fix vw_redemption_pnl - Use Working Join Path
 *
 * CURRENT: Joins to market_resolutions_final (broken - empty condition_id_norm)
 * FIX: Use token_condition_market_map → vw_resolutions_truth (working)
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

async function fixRedemptionPnL() {
  console.log('================================================================================');
  console.log('🔧 FIXING vw_redemption_pnl');
  console.log('================================================================================\n');

  // Update vw_redemption_pnl to use the working join
  console.log('1️⃣ Updating vw_redemption_pnl to use token_condition_market_map → vw_resolutions_truth...');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_redemption_pnl AS
      WITH positions_at_resolution AS (
        SELECT
          wallet,
          market_cid,
          outcome,
          sum(d_shares) AS net_shares,
          sum(d_cash) AS net_cash
        FROM cascadian_clean.vw_trades_ledger
        GROUP BY wallet, market_cid, outcome
      ),
      market_resolutions AS (
        SELECT
          m.market_id_cid AS market_cid,
          any(lower(m.condition_id_32b)) AS condition_id_32b,
          any(r.payout_numerators) AS payout_numerators,
          any(r.payout_denominator) AS payout_denominator,
          any(r.winning_index) AS winning_index
        FROM cascadian_clean.token_condition_market_map m
        INNER JOIN cascadian_clean.vw_resolutions_truth r
          ON r.condition_id_32b = lower(m.condition_id_32b)
        GROUP BY m.market_id_cid
      )
      SELECT
        p.wallet AS wallet,
        p.market_cid AS market_cid,
        p.outcome AS outcome,
        p.net_shares AS net_shares,
        p.net_cash AS net_cash,
        r.winning_index AS winning_index,
        if(
          p.outcome < length(r.payout_numerators),
          toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
          0.
        ) AS payout_value,
        (p.net_shares * if(
          p.outcome < length(r.payout_numerators),
          toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
          0.
        )) + p.net_cash AS redemption_pnl_usd
      FROM positions_at_resolution AS p
      INNER JOIN market_resolutions AS r ON r.market_cid = p.market_cid
      WHERE abs(p.net_shares) >= 0.01
    `,
  });

  console.log('   ✅ View updated\n');

  // Test the fixed view
  console.log('2️⃣ Testing vw_redemption_pnl...');
  const redemptionQuery = await ch.query({
    query: `
      SELECT
        count() as position_count,
        sum(redemption_pnl_usd) as total_redemption_pnl
      FROM cascadian_clean.vw_redemption_pnl
      WHERE lower(wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const redemptionData = await redemptionQuery.json<any>();

  console.log(`   Redeemed positions: ${redemptionData[0].position_count}`);
  console.log(`   Redemption P&L: $${redemptionData[0].total_redemption_pnl}\n`);

  // Now check total P&L
  console.log('3️⃣ Calculating total P&L...');
  const tradingQuery = await ch.query({
    query: `
      SELECT sum(realized_pnl_usd) as trading_pnl
      FROM cascadian_clean.vw_trading_pnl_realized
      WHERE lower(wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const tradingData = await tradingQuery.json<any>();

  const tradingPnL = parseFloat(tradingData[0].trading_pnl);
  const redemptionPnL = parseFloat(redemptionData[0].total_redemption_pnl || 0);
  const totalPnL = tradingPnL + redemptionPnL;

  console.log(`   Trading P&L: $${tradingPnL.toFixed(2)}`);
  console.log(`   Redemption P&L: $${redemptionPnL.toFixed(2)}`);
  console.log(`   Total P&L: $${totalPnL.toFixed(2)}\n`);

  console.log('4️⃣ Comparison to Polymarket:');
  console.log(`   Polymarket: $332,563`);
  console.log(`   Our system: $${totalPnL.toFixed(2)}`);
  console.log(`   Match: ${((totalPnL / 332563) * 100).toFixed(1)}%\n`);

  if (Math.abs(totalPnL - 332563) < 10000) {
    console.log('   ✅ SUCCESS: Within tolerance!');
  } else {
    console.log('   NOTE: We only have 31/2,816 markets (1.1%) for this wallet');
    console.log('   Run API backfill to import the missing 2,785 markets');
  }

  console.log('\n================================================================================');
  console.log('✅ VIEW UPDATED');
  console.log('================================================================================');

  await ch.close();
}

fixRedemptionPnL().catch(console.error);
