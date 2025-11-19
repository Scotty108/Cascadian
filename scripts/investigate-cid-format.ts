#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

(async () => {
  console.log('\n🔍 Investigating what "cid" represents in fact_trades_clean...\n');

  // Sample wallet's top traded "markets"
  const trades = await ch.query({
    query: `
      SELECT
        cid,
        lower(replaceAll(cid, '0x', '')) as cid_normalized,
        COUNT(*) as trade_count,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade,
        SUM(usdc_amount) as total_volume
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      GROUP BY cid
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const data = await trades.json();
  console.log('Top 5 most-traded "markets" for this wallet:\n');
  for (let i = 0; i < data.length; i++) {
    const t = data[i];
    console.log(`${i+1}. CID: ${t.cid}`);
    console.log(`   Normalized: ${t.cid_normalized}`);
    console.log(`   Trades: ${t.trade_count}`);
    console.log(`   First: ${t.first_trade}`);
    console.log(`   Last: ${t.last_trade}`);
    console.log(`   Volume: $${parseFloat(t.total_volume).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
    console.log();
  }

  // Check if ANY of these exist in api_markets_staging by any column
  const topCid = data[0].cid_normalized;
  console.log(`Checking if "${topCid.substring(0, 16)}..." matches anything in api_markets_staging:\n`);

  const matchCheck = await ch.query({
    query: `
      SELECT
        condition_id,
        question,
        market_slug
      FROM default.api_markets_staging
      WHERE lower(replaceAll(condition_id, '0x', '')) = '${topCid}'
        OR condition_id = '${topCid}'
        OR condition_id = '0x${topCid}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const match = await matchCheck.json();
  if (match.length > 0) {
    console.log('  ✅ FOUND MATCH:');
    console.log(`     Question: ${match[0].question}`);
    console.log(`     Slug: ${match[0].market_slug}`);
  } else {
    console.log('  ❌ NO MATCH in api_markets_staging');
  }

  // Check what the schema of fact_trades_clean says about cid
  console.log('\n📋 Checking fact_trades_clean table comment/description:\n');
  
  const schema = await ch.query({
    query: `
      SELECT
        name,
        type,
        comment
      FROM system.columns
      WHERE database = 'default'
        AND table = 'fact_trades_clean'
        AND name = 'cid'
    `,
    format: 'JSONEachRow',
  });

  const col = await schema.json();
  if (col.length > 0) {
    console.log(`  Column: ${col[0].name}`);
    console.log(`  Type: ${col[0].type}`);
    console.log(`  Comment: ${col[0].comment || 'No comment'}`);
  }

  await ch.close();
})();
