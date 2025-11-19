#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('🔍 Correct Wallet Mapping Test\n');
  console.log(`UI Wallet:     ${UI_WALLET}`);
  console.log(`System Wallet: ${SYSTEM_WALLET}\n`);

  // 1. Get THIS USER's markets from wallet map
  console.log('=== STEP 1: Get User Markets from Wallet Map ===\n');
  const userMarketsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        cid_hex as condition_id_norm,
        count() as trade_count
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
        AND system_wallet = '${SYSTEM_WALLET}'
      GROUP BY cid_hex
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const userMarkets = await userMarketsResult.json<Array<any>>();
  console.log(`Found ${userMarkets.length} markets for this user\n`);

  // 2. Join with gamma_markets to get titles
  console.log('=== STEP 2: Get Market Titles ===\n');
  const cidList = userMarkets.map(m => `'${m.condition_id_norm}'`).join(',');

  const titlesResult = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        question,
        closed
      FROM default.gamma_markets
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${cidList})
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const titles = await titlesResult.json<Array<any>>();
  console.log('Top markets with titles:\n');
  titles.forEach((t, i) => {
    console.log(`${i+1}. ${t.question}`);
    console.log(`   CID: ${t.condition_id_norm.substring(0, 16)}...`);
    console.log(`   Closed: ${t.closed === 1 ? 'Yes' : 'No'}\n`);
  });

  // 3. Search for egg market
  console.log('=== STEP 3: Search for Egg Market in User Markets ===\n');
  const eggResult = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(g.condition_id, '0x', '')) as condition_id_norm,
        g.question,
        g.closed
      FROM default.gamma_markets g
      WHERE lower(replaceAll(g.condition_id, '0x', '')) IN (${cidList})
        AND g.question LIKE '%egg%'
    `,
    format: 'JSONEachRow'
  });
  const eggMarkets = await eggResult.json<Array<any>>();

  if (eggMarkets.length > 0) {
    console.log(`✅ Found ${eggMarkets.length} egg markets!\n`);
    eggMarkets.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   CID: ${m.condition_id_norm.substring(0, 16)}...\n`);
    });
  } else {
    console.log('❌ No egg markets found in this user\'s markets\n');
    console.log('This could mean:');
    console.log('  1. The wallet mapping is incomplete');
    console.log('  2. Egg trades are in missing block range');
    console.log('  3. Different wallet was used for egg trades\n');
  }

  // 4. Calculate P&L using wallet map data
  console.log('=== STEP 4: Calculate P&L from Wallet Map ===\n');
  const pnlResult = await clickhouse.query({
    query: `
      WITH user_trades AS (
        SELECT
          cid_hex as condition_id_norm,
          direction,
          toFloat64(shares) as shares,
          toFloat64(usdc_amount) as usdc_amount
        FROM cascadian_clean.system_wallet_map
        WHERE user_wallet = '${UI_WALLET}'
          AND system_wallet = '${SYSTEM_WALLET}'
          AND confidence = 'HIGH'
      ),
      position_summary AS (
        SELECT
          condition_id_norm,
          sum(if(direction = 'BUY', shares, -shares)) as net_shares,
          sum(if(direction = 'BUY', -usdc_amount, usdc_amount)) as net_cashflow
        FROM user_trades
        GROUP BY condition_id_norm
      ),
      with_resolutions AS (
        SELECT
          p.*,
          r.payout_numerators,
          r.payout_denominator,
          r.winning_index
        FROM position_summary p
        INNER JOIN default.market_resolutions_final r
          ON p.condition_id_norm = r.condition_id_norm
      )
      SELECT
        count() as positions,
        sum(net_shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) + net_cashflow) as total_pnl
      FROM with_resolutions
      WHERE net_shares != 0
    `,
    format: 'JSONEachRow'
  });
  const pnl = await pnlResult.json<Array<any>>();

  console.log(`Positions: ${parseInt(pnl[0].positions)}`);
  console.log(`Total P&L: $${parseFloat(pnl[0].total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);

  console.log('=== COMPARISON ===\n');
  console.log(`Polymarket UI P&L:  $95,373.13`);
  console.log(`Our Calculated P&L: $${parseFloat(pnl[0].total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`Difference:         $${(95373.13 - parseFloat(pnl[0].total_pnl)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`);
}

main().catch(console.error);
