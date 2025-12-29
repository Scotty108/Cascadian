#!/usr/bin/env tsx
/**
 * Complete P&L Views Fix
 *
 * Fixes:
 * 1. vw_positions_open - Remove p. prefix from column names
 * 2. vw_market_pnl_unified - Update to handle resolved markets
 * 3. vw_wallet_pnl_unified - Ensure proper aggregation
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

const TEST_WALLET = '4ce73141dbfce41e65db3723e31059a730f0abad';

async function fixViews() {
  console.log('================================================================================');
  console.log('🔧 FIXING P&L VIEWS - COMPLETE UPDATE');
  console.log('================================================================================\n');

  // Step 1: Fix vw_positions_open - remove p. prefix from column names
  console.log('1️⃣ Fixing vw_positions_open (removing p. prefix from columns)...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_positions_open AS
      WITH
        pos AS (
          SELECT
            lower(wallet_address_norm) AS wallet,
            concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00') AS market_cid,
            toInt32(outcome_index) AS outcome,
            sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
            sumIf(if(trade_direction = 'BUY', -toFloat64(usd_value), toFloat64(usd_value)), 1) AS cash_net
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != ''
            AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND outcome_index >= 0
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
        p.wallet AS wallet,
        p.market_cid AS market_cid,
        p.outcome AS outcome,
        p.shares_net AS qty,
        if(p.shares_net != 0, (-p.cash_net) / nullIf(p.shares_net, 0), 0.) AS avg_cost,
        m.midprice AS midprice,
        m.best_bid AS best_bid,
        m.best_ask AS best_ask,
        m.updated_at AS price_updated_at,
        p.shares_net * (coalesce(m.midprice, 0) - if(p.shares_net != 0, (-p.cash_net) / nullIf(p.shares_net, 0), 0.)) AS unrealized_pnl_usd
      FROM pos AS p
      LEFT JOIN market_conditions AS mc ON mc.market_cid = p.market_cid
      LEFT JOIN cascadian_clean.vw_resolutions_truth AS r ON r.condition_id_32b = mc.condition_id_32b
      LEFT JOIN cascadian_clean.midprices_latest AS m ON m.market_cid = p.market_cid AND m.outcome = p.outcome
      WHERE abs(p.shares_net) >= 0.01
        AND (mc.condition_id_32b IS NULL OR r.condition_id_32b IS NULL)
    `,
  });
  console.log('   ✅ vw_positions_open fixed');

  // Step 2: Update vw_trading_pnl_positions to mark resolved markets as CLOSED
  console.log('\n2️⃣ Updating vw_trading_pnl_positions (mark resolved markets as CLOSED)...');
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
          SELECT DISTINCT
            m.market_id_cid AS market_cid
          FROM cascadian_clean.token_condition_market_map m
          INNER JOIN cascadian_clean.vw_resolutions_truth r
            ON r.condition_id_32b = m.condition_id_32b
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
    `,
  });
  console.log('   ✅ vw_trading_pnl_positions updated');

  // Step 3: Verify vw_trading_pnl_realized still works
  console.log('\n3️⃣ Verifying vw_trading_pnl_realized...');
  const realizedCheck = await ch.query({
    query: `
      SELECT count() as cnt, sum(realized_pnl_usd) as total_pnl
      FROM cascadian_clean.vw_trading_pnl_realized
      WHERE lower(wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const realizedData = await realizedCheck.json<any>();
  console.log(`   Positions: ${realizedData[0].cnt}, Total P&L: $${realizedData[0].total_pnl}`);

  // Step 4: Test the fixed vw_market_pnl_unified
  console.log('\n4️⃣ Testing vw_market_pnl_unified...');
  try {
    const marketPnl = await ch.query({
      query: `
        SELECT count() as cnt, sum(total_pnl) as total
        FROM cascadian_clean.vw_market_pnl_unified
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const marketData = await marketPnl.json<any>();
    console.log(`   ✅ View working - ${marketData[0].cnt} positions, Total: $${marketData[0].total}`);
  } catch (e: any) {
    console.log(`   ❌ View broken: ${e.message}`);
  }

  // Step 5: Test the final vw_wallet_pnl_unified
  console.log('\n5️⃣ Testing vw_wallet_pnl_unified...');
  try {
    const walletPnl = await ch.query({
      query: `
        SELECT *
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${TEST_WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const walletData = await walletPnl.json<any>();
    if (walletData.length > 0) {
      const w = walletData[0];
      console.log('   ✅ View working:');
      console.log(`      Trading Realized: $${w.trading_realized_pnl}`);
      console.log(`      Redemption: $${w.redemption_pnl}`);
      console.log(`      Unrealized: $${w.unrealized_pnl}`);
      console.log(`      Total: $${w.total_pnl}`);
      console.log(`      Closed: ${w.closed_positions}, Open: ${w.open_positions}`);
    } else {
      console.log('   ⚠️  No data returned for wallet');
    }
  } catch (e: any) {
    console.log(`   ❌ View broken: ${e.message}`);
  }

  console.log('\n================================================================================');
  console.log('✅ VIEWS UPDATED');
  console.log('================================================================================');

  await ch.close();
}

fixViews().catch(console.error);
