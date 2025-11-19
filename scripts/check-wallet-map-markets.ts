#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('=== Step 1: Count Total Markets in Wallet Map ===\n');
  
  const countResult = await clickhouse.query({
    query: `
      SELECT
        uniqExact(cid_hex) as unique_markets,
        count() as total_trades
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
        AND system_wallet = '${SYSTEM_WALLET}'
    `,
    format: 'JSONEachRow'
  });
  const counts = await countResult.json<Array<any>>();
  console.log(`Unique markets: ${counts[0].unique_markets}`);
  console.log(`Total trades mapped: ${counts[0].total_trades}\n`);

  console.log('=== Step 2: Get Sample Markets with Titles ===\n');
  
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        m.cid_hex,
        g.question,
        count() as trade_count,
        sum(toFloat64(m.usdc_amount)) as total_volume
      FROM cascadian_clean.system_wallet_map m
      LEFT JOIN default.gamma_markets g
        ON m.cid_hex = g.condition_id
      WHERE m.user_wallet = '${UI_WALLET}'
        AND m.system_wallet = '${SYSTEM_WALLET}'
      GROUP BY m.cid_hex, g.question
      ORDER BY total_volume DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const markets = await marketsResult.json<Array<any>>();
  
  const withTitles = markets.filter(m => m.question);
  const withoutTitles = markets.filter(m => !m.question);
  
  console.log(`Markets WITH titles: ${withTitles.length}`);
  console.log(`Markets WITHOUT titles: ${withoutTitles.length}\n`);
  
  if (withTitles.length > 0) {
    console.log('Top markets with titles:\n');
    withTitles.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Trades: ${m.trade_count}, Volume: $${parseFloat(m.total_volume).toFixed(2)}`);
      console.log(`   CID: ${m.cid_hex.substring(0, 20)}...\n`);
    });
  }
  
  if (withoutTitles.length > 0) {
    console.log(`\n${withoutTitles.length} markets without titles (first 5):\n`);
    withoutTitles.slice(0, 5).forEach((m, i) => {
      console.log(`${i+1}. CID: ${m.cid_hex}`);
      console.log(`   Trades: ${m.trade_count}, Volume: $${parseFloat(m.total_volume).toFixed(2)}\n`);
    });
  }

  console.log('=== Step 3: Search for Egg Market ===\n');
  
  const eggResult = await clickhouse.query({
    query: `
      SELECT
        g.condition_id,
        g.question,
        count() as trade_count
      FROM cascadian_clean.system_wallet_map m
      INNER JOIN default.gamma_markets g
        ON m.cid_hex = g.condition_id
      WHERE m.user_wallet = '${UI_WALLET}'
        AND m.system_wallet = '${SYSTEM_WALLET}'
        AND g.question LIKE '%egg%'
      GROUP BY g.condition_id, g.question
    `,
    format: 'JSONEachRow'
  });
  const eggMarkets = await eggResult.json<Array<any>>();
  
  if (eggMarkets.length > 0) {
    console.log(`✅ Found ${eggMarkets.length} egg markets!\n`);
    eggMarkets.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Trades: ${m.trade_count}\n`);
    });
  } else {
    console.log('❌ No egg markets found in mapped trades\n');
  }
}

main().catch(console.error);
