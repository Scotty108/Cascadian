#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('=== Getting Market Titles from dim_markets ===\n');
  
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(m.cid_hex, '0x', '')) as cid_norm,
        d.question,
        d.volume,
        count() as trade_count,
        sum(toFloat64(m.usdc_amount)) as total_usdc
      FROM cascadian_clean.system_wallet_map m
      INNER JOIN default.dim_markets d
        ON lower(replaceAll(m.cid_hex, '0x', '')) = d.condition_id_norm
      WHERE m.user_wallet = '${UI_WALLET}'
        AND m.system_wallet = '${SYSTEM_WALLET}'
      GROUP BY cid_norm, d.question, d.volume
      ORDER BY total_usdc DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });
  const markets = await marketsResult.json<Array<any>>();
  
  console.log(`Found ${markets.length} markets with titles:\n`);
  
  const withTitles = markets.filter(m => m.question);
  const withoutTitles = markets.filter(m => !m.question);
  
  console.log(`Markets with titles: ${withTitles.length}/77`);
  console.log(`Markets without titles: ${withoutTitles.length}/77\n`);
  
  if (withTitles.length > 0) {
    console.log('=== Top 20 Markets by Volume ===\n');
    withTitles.slice(0, 20).forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Trades: ${m.trade_count}, Volume: $${parseFloat(m.total_usdc).toFixed(2)}`);
      console.log(`   Market Vol: $${parseFloat(m.volume || 0).toFixed(2)}\n`);
    });
  }

  console.log('\n=== Searching for Egg Market ===\n');
  
  const eggResult = await clickhouse.query({
    query: `
      SELECT
        d.condition_id_norm,
        d.question,
        count() as trade_count,
        sum(toFloat64(m.usdc_amount)) as total_usdc
      FROM cascadian_clean.system_wallet_map m
      INNER JOIN default.dim_markets d
        ON lower(replaceAll(m.cid_hex, '0x', '')) = d.condition_id_norm
      WHERE m.user_wallet = '${UI_WALLET}'
        AND m.system_wallet = '${SYSTEM_WALLET}'
        AND (
          d.question LIKE '%egg%'
          OR d.question LIKE '%Egg%'
        )
      GROUP BY d.condition_id_norm, d.question
    `,
    format: 'JSONEachRow'
  });
  const eggMarkets = await eggResult.json<Array<any>>();
  
  if (eggMarkets.length > 0) {
    console.log(`✅ Found ${eggMarkets.length} egg markets!\n`);
    eggMarkets.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Trades: ${m.trade_count}`);
      console.log(`   Total USDC: $${parseFloat(m.total_usdc).toFixed(2)}\n`);
    });
  } else {
    console.log('❌ No egg markets found in mapped trades\n');
    console.log('This confirms: The 77 markets in system_wallet_map');
    console.log('are NOT the same 192 markets shown in Polymarket UI\n');
  }

  console.log('=== Summary ===\n');
  console.log(`System wallet map has:     77 markets`);
  console.log(`Polymarket UI shows:       192 predictions`);
  console.log(`Missing coverage:          ${192 - 77} markets (${((115/192)*100).toFixed(1)}%)\n`);
  console.log('Conclusion: system_wallet_map is incomplete.');
  console.log('Need to investigate why only 77/192 markets are mapped.\n');
}

main().catch(console.error);
