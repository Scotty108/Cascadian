#!/usr/bin/env tsx
/**
 * Debug Join Path - Why aren't resolutions matching?
 *
 * Investigates the join chain:
 * trades → market_cid → token_condition_market_map → vw_resolutions_truth
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

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function debugJoinPath() {
  console.log('================================================================================');
  console.log('🔍 DEBUGGING JOIN PATH');
  console.log('================================================================================\n');

  // Step 1: Get wallet's markets
  console.log('1️⃣ Getting wallet markets from trades...');
  const marketsQuery = await ch.query({
    query: `
      SELECT DISTINCT
        market_cid,
        count() as trade_count
      FROM cascadian_clean.vw_trades_ledger
      WHERE lower(wallet) = lower('${TEST_WALLET}')
      GROUP BY market_cid
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const markets = await marketsQuery.json<any>();
  console.log(`   Found ${markets.length} sample markets:\n`);
  markets.forEach((m: any, i: number) => {
    console.log(`   ${i + 1}. ${m.market_cid} (${m.trade_count} trades)`);
  });

  // Step 2: Check if these markets exist in token_condition_market_map
  console.log('\n2️⃣ Checking token_condition_market_map for these markets...');
  const firstMarket = markets[0].market_cid;
  const mapQuery = await ch.query({
    query: `
      SELECT
        market_id_cid,
        condition_id_32b,
        token_id_erc1155
      FROM cascadian_clean.token_condition_market_map
      WHERE market_id_cid = '${firstMarket}'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const mapData = await mapQuery.json<any>();

  if (mapData.length > 0) {
    console.log(`   ✅ Found ${mapData.length} mappings for ${firstMarket}:`);
    mapData.forEach((row: any, i: number) => {
      console.log(`      ${i + 1}. condition_id_32b: ${row.condition_id_32b}`);
      console.log(`         token_id_erc1155: ${row.token_id_erc1155}`);
    });

    // Step 3: Check if those condition_ids exist in vw_resolutions_truth
    const conditionId = mapData[0].condition_id_32b;
    console.log(`\n3️⃣ Checking vw_resolutions_truth for condition_id: ${conditionId}...`);
    const resQuery = await ch.query({
      query: `
        SELECT
          condition_id_32b,
          payout_numerators,
          payout_denominator
        FROM cascadian_clean.vw_resolutions_truth
        WHERE condition_id_32b = '${conditionId}'
      `,
      format: 'JSONEachRow',
    });
    const resData = await resQuery.json<any>();

    if (resData.length > 0) {
      console.log(`   ✅ Resolution found!`);
      console.log(`      Payout numerators: ${resData[0].payout_numerators}`);
      console.log(`      Payout denominator: ${resData[0].payout_denominator}`);
    } else {
      console.log(`   ❌ NO RESOLUTION FOUND for ${conditionId}`);

      // Check what's actually in vw_resolutions_truth
      console.log('\n   Checking what condition_ids exist in vw_resolutions_truth...');
      const sampleRes = await ch.query({
        query: `
          SELECT condition_id_32b
          FROM cascadian_clean.vw_resolutions_truth
          LIMIT 5
        `,
        format: 'JSONEachRow',
      });
      const samples = await sampleRes.json<any>();
      console.log('   Sample condition_ids in vw_resolutions_truth:');
      samples.forEach((s: any, i: number) => {
        console.log(`      ${i + 1}. ${s.condition_id_32b}`);
      });
    }
  } else {
    console.log(`   ❌ NO MAPPING FOUND for ${firstMarket}`);

    // Check what's actually in token_condition_market_map
    console.log('\n   Checking what market_ids exist in token_condition_market_map...');
    const sampleMap = await ch.query({
      query: `
        SELECT DISTINCT market_id_cid
        FROM cascadian_clean.token_condition_market_map
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const samples = await sampleMap.json<any>();
    console.log('   Sample market_ids in token_condition_market_map:');
    samples.forEach((s: any, i: number) => {
      console.log(`      ${i + 1}. ${s.market_id_cid}`);
    });
  }

  // Step 4: Check for format differences
  console.log('\n4️⃣ Checking for format differences...');
  console.log(`   Wallet market_cid format: ${firstMarket}`);
  console.log(`   Length: ${firstMarket.length}`);
  console.log(`   Has 0x prefix: ${firstMarket.startsWith('0x')}`);

  const mapSample = await ch.query({
    query: `
      SELECT market_id_cid
      FROM cascadian_clean.token_condition_market_map
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const mapSampleData = await mapSample.json<any>();
  if (mapSampleData.length > 0) {
    const mapMarketId = mapSampleData[0].market_id_cid;
    console.log(`\n   token_condition_market_map market_id format: ${mapMarketId}`);
    console.log(`   Length: ${mapMarketId.length}`);
    console.log(`   Has 0x prefix: ${mapMarketId.startsWith('0x')}`);
  }

  console.log('\n================================================================================');
  console.log('✅ DEBUG COMPLETE');
  console.log('================================================================================');

  await ch.close();
}

debugJoinPath().catch(console.error);
