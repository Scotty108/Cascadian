#!/usr/bin/env tsx
/**
 * Investigate where to fetch missing 148K market payout vectors
 * 
 * Potential sources:
 * 1. Blockchain: CTF contract PayoutRedemption events
 * 2. Polymarket Gamma API
 * 3. CLOB API 
 * 4. Existing tables we might have missed
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 FINDING PAYOUT DATA SOURCES FOR MISSING 148K MARKETS');
  console.log('═'.repeat(80));

  // Step 1: Get sample of missing markets
  console.log('\n📊 Step 1: Getting sample of missing market condition IDs...');

  const missingMarkets = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      resolution_status AS (
        SELECT
          tm.condition_id,
          r.payout_denominator,
          CASE
            WHEN r.payout_denominator > 0 THEN 'HAS_PAYOUT'
            WHEN r.payout_denominator = 0 THEN 'ZERO_DENOMINATOR'
            WHEN r.condition_id_norm IS NULL THEN 'NO_RECORD'
            ELSE 'UNKNOWN'
          END as status
        FROM traded_markets tm
        LEFT JOIN default.market_resolutions_final r
          ON tm.condition_id = r.condition_id_norm
      )
      SELECT condition_id, status
      FROM resolution_status
      WHERE status != 'HAS_PAYOUT'
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const missing = await missingMarkets.json();
  console.log(`\nFound ${missing.length} sample markets without payouts:`);
  console.log(`  Status breakdown:`);
  const statusCounts = missing.reduce((acc: any, m: any) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`    ${status}: ${count}`);
  });

  // Step 2: Check what other tables exist that might have payout data
  console.log('\n📊 Step 2: Checking existing tables for payout data...');

  const tables = await ch.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE database = 'default'
        AND (
          name LIKE '%payout%'
          OR name LIKE '%resolution%'
          OR name LIKE '%ctf%'
          OR name LIKE '%condition%'
        )
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });

  const tableList = await tables.json();
  console.log('\nTables that might contain payout data:');
  tableList.forEach((t: any) => {
    console.log(`  ${t.name} (${t.engine}): ${t.total_rows} rows`);
  });

  // Step 3: Check if we have blockchain payout events
  console.log('\n📊 Step 3: Checking for blockchain payout events...');

  // Check for any ERC1155 or CTF-related tables
  const erc1155Tables = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE '%erc1155%' OR name LIKE '%transfer%' OR name LIKE '%event%')
      ORDER BY total_rows DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const erc1155List = await erc1155Tables.json();
  console.log('\nERC1155/Transfer tables:');
  erc1155List.forEach((t: any) => {
    console.log(`  ${t.name}: ${t.total_rows} rows`);
  });

  // Step 4: Sample one missing market and try to find it in other sources
  const testCid = missing[0]?.condition_id;
  
  if (testCid) {
    console.log(`\n📊 Step 4: Deep dive on sample market ${testCid.substring(0, 16)}...`);

    // Check Gamma API
    console.log('\n  Checking Gamma API...');
    try {
      const gammaUrl = `https://gamma-api.polymarket.com/markets?condition_id=${testCid}`;
      const gammaResp = await fetch(gammaUrl);
      const gammaData = await gammaResp.json();
      
      if (Array.isArray(gammaData) && gammaData.length > 0) {
        const market = gammaData[0];
        console.log(`    ✅ Found in Gamma API`);
        console.log(`    Question: ${market.question}`);
        console.log(`    Active: ${market.active}, Closed: ${market.closed}`);
        console.log(`    Has outcomes: ${market.outcomes ? 'Yes' : 'No'}`);
        console.log(`    Has outcomePrices: ${market.outcomePrices ? 'Yes' : 'No'}`);
      } else {
        console.log(`    ❌ Not found in Gamma API`);
      }
    } catch (error) {
      console.log(`    ❌ Error fetching from Gamma API:`, error);
    }

    // Check if we have trades for this market
    console.log('\n  Checking if we have trade data for this market...');
    const tradeCheck = await ch.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade,
          COUNT(DISTINCT wallet_address) as unique_wallets
        FROM default.fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) = '${testCid}'
      `,
      format: 'JSONEachRow',
    });

    const tradeData = await tradeCheck.json();
    console.log(`    Trade data:`, JSON.stringify(tradeData[0], null, 2));
  }

  // Step 5: Check api_markets_staging for payout data
  console.log('\n📊 Step 5: Checking api_markets_staging for resolution data...');

  const apiMarketsSample = await ch.query({
    query: `
      SELECT
        condition_id,
        question,
        active,
        closed,
        resolved,
        winning_outcome,
        arrayLength(outcomes) as num_outcomes
      FROM default.api_markets_staging
      WHERE condition_id IN (
        SELECT condition_id FROM (
          SELECT condition_id, status
          FROM (
            WITH traded_markets AS (
              SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
              FROM default.fact_trades_clean
            )
            SELECT
              tm.condition_id,
              CASE
                WHEN r.payout_denominator > 0 THEN 'HAS_PAYOUT'
                WHEN r.payout_denominator = 0 THEN 'ZERO_DENOMINATOR'
                ELSE 'NO_RECORD'
              END as status
            FROM traded_markets tm
            LEFT JOIN default.market_resolutions_final r
              ON tm.condition_id = r.condition_id_norm
            WHERE r.payout_denominator IS NULL OR r.payout_denominator = 0
            LIMIT 10
          )
        )
      )
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const apiSample = await apiMarketsSample.json();
  console.log(`\nSample of missing markets in api_markets_staging:`);
  apiSample.forEach((m: any, i: number) => {
    console.log(`\n${i + 1}. ${m.question}`);
    console.log(`   CID: ${m.condition_id.substring(0, 16)}...`);
    console.log(`   Active: ${m.active}, Closed: ${m.closed}, Resolved: ${m.resolved}`);
    console.log(`   Winning outcome: ${m.winning_outcome || 'NULL'}`);
    console.log(`   Num outcomes: ${m.num_outcomes}`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('✅ INVESTIGATION COMPLETE');
  console.log('═'.repeat(80));
  console.log('\nNext steps to investigate:');
  console.log('  1. Check if Gamma API has market resolution data we can fetch');
  console.log('  2. Check blockchain CTF contract for PayoutRedemption events');
  console.log('  3. Verify api_markets_staging has the data but market_resolutions_final is incomplete');
  console.log('  4. Check CLOB API for market status/resolution data');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
