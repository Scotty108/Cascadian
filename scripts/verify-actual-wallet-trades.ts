#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('=== Comprehensive Wallet Trade Analysis ===\n');
  
  // 1. Check UI wallet in trades_raw
  console.log('--- UI Wallet in trades_raw ---\n');
  const uiResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(condition_id) as unique_markets,
        min(created_at) as earliest,
        max(created_at) as latest,
        sum(toFloat64(abs(cashflow_usdc))) as total_volume
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${UI_WALLET}')
    `,
    format: 'JSONEachRow'
  });
  const uiData = await uiResult.json<Array<any>>();
  console.log(`Trades: ${uiData[0].total_trades}`);
  console.log(`Markets: ${uiData[0].unique_markets}`);
  console.log(`Date range: ${uiData[0].earliest} to ${uiData[0].latest}`);
  console.log(`Volume: $${parseFloat(uiData[0].total_volume).toFixed(2)}\n`);
  
  // 2. Check system wallet in trades_raw
  console.log('--- System Wallet in trades_raw ---\n');
  const sysResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(condition_id) as unique_markets,
        min(created_at) as earliest,
        max(created_at) as latest,
        sum(toFloat64(abs(cashflow_usdc))) as total_volume
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${SYSTEM_WALLET}')
    `,
    format: 'JSONEachRow'
  });
  const sysData = await sysResult.json<Array<any>>();
  console.log(`Trades: ${sysData[0].total_trades.toLocaleString()}`);
  console.log(`Markets: ${sysData[0].unique_markets.toLocaleString()}`);
  console.log(`Date range: ${sysData[0].earliest} to ${sysData[0].latest}`);
  console.log(`Volume: $${parseFloat(sysData[0].total_volume).toFixed(2)}\n`);
  
  // 3. Check if UI wallet trades have metadata
  console.log('--- UI Wallet Markets with Metadata ---\n');
  const metaResult = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id) as markets_with_meta
      FROM default.trades_raw t
      INNER JOIN default.gamma_markets g
        ON t.condition_id = g.condition_id
      WHERE lower(t.wallet) = lower('${UI_WALLET}')
        AND g.question IS NOT NULL
        AND g.question != ''
    `,
    format: 'JSONEachRow'
  });
  const metaData = await metaResult.json<Array<any>>();
  console.log(`Markets with gamma_markets metadata: ${metaData[0].markets_with_meta}/${uiData[0].unique_markets}`);
  
  // Try dim_markets
  const dimMetaResult = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id) as markets_with_meta
      FROM default.trades_raw t
      INNER JOIN default.dim_markets d
        ON lower(replaceAll(t.condition_id, '0x', '')) = d.condition_id_norm
      WHERE lower(t.wallet) = lower('${UI_WALLET}')
        AND d.question IS NOT NULL
        AND d.question != ''
    `,
    format: 'JSONEachRow'
  });
  const dimMetaData = await dimMetaResult.json<Array<any>>();
  console.log(`Markets with dim_markets metadata: ${dimMetaData[0].markets_with_meta}/${uiData[0].unique_markets}\n`);
  
  // 4. Sample UI wallet markets with titles
  if (dimMetaData[0].markets_with_meta > 0) {
    console.log('--- Top 10 UI Wallet Markets (with titles) ---\n');
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          d.question,
          count() as trades,
          sum(toFloat64(abs(t.cashflow_usdc))) as volume
        FROM default.trades_raw t
        INNER JOIN default.dim_markets d
          ON lower(replaceAll(t.condition_id, '0x', '')) = d.condition_id_norm
        WHERE lower(t.wallet) = lower('${UI_WALLET}')
          AND d.question IS NOT NULL
          AND d.question != ''
        GROUP BY d.question
        ORDER BY volume DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<Array<any>>();
    samples.forEach((s, i) => {
      console.log(`${i+1}. ${s.question}`);
      console.log(`   Trades: ${s.trades}, Volume: $${parseFloat(s.volume).toFixed(2)}\n`);
    });
  }
  
  // 5. Search for egg market in UI wallet
  console.log('--- Searching for Egg Market in UI Wallet ---\n');
  const eggResult = await clickhouse.query({
    query: `
      SELECT
        d.question,
        count() as trades,
        sum(toFloat64(abs(t.cashflow_usdc))) as volume
      FROM default.trades_raw t
      INNER JOIN default.dim_markets d
        ON lower(replaceAll(t.condition_id, '0x', '')) = d.condition_id_norm
      WHERE lower(t.wallet) = lower('${UI_WALLET}')
        AND d.question LIKE '%egg%'
      GROUP BY d.question
    `,
    format: 'JSONEachRow'
  });
  const eggMarkets = await eggResult.json<Array<any>>();
  
  if (eggMarkets.length > 0) {
    console.log(`✅ Found ${eggMarkets.length} egg markets!\n`);
    eggMarkets.forEach((m, i) => {
      console.log(`${i+1}. ${m.question}`);
      console.log(`   Trades: ${m.trades}, Volume: $${parseFloat(m.volume).toFixed(2)}\n`);
    });
  } else {
    console.log('❌ No egg markets found in UI wallet trades\n');
  }
}

main().catch(console.error);
