#!/usr/bin/env tsx
/**
 * Test Resolved Markets CTE
 *
 * Tests if the resolved_markets CTE is finding any of wallet 0x4ce7's markets
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

async function testCTE() {
  console.log('================================================================================');
  console.log('🔍 TESTING RESOLVED_MARKETS CTE');
  console.log('================================================================================\n');

  // Step 1: Get wallet's markets
  console.log('1️⃣ Getting wallet markets...');
  const marketsQuery = await ch.query({
    query: `
      SELECT DISTINCT market_cid
      FROM cascadian_clean.vw_trades_ledger
      WHERE lower(wallet) = lower('${TEST_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const walletMarkets = await marketsQuery.json<any>();
  console.log(`   Found ${walletMarkets.length} markets for wallet`);
  walletMarkets.forEach((m: any, i: number) => {
    console.log(`      ${i + 1}. ${m.market_cid}`);
  });

  // Step 2: Test resolved_markets CTE
  console.log('\n2️⃣ Testing resolved_markets CTE...');
  const resolvedQuery = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT m.market_id_cid AS market_cid
        FROM cascadian_clean.token_condition_market_map AS m
        INNER JOIN cascadian_clean.vw_resolutions_truth AS r
          ON r.condition_id_32b = m.condition_id_32b
      )
      SELECT count() as total_resolved
      FROM resolved_markets
    `,
    format: 'JSONEachRow',
  });
  const resolvedData = await resolvedQuery.json<any>();
  console.log(`   Total resolved markets in system: ${resolvedData[0].total_resolved}`);

  // Step 3: Check if ANY of wallet's markets are in resolved_markets
  console.log('\n3️⃣ Checking if wallet markets are in resolved_markets...');
  const firstMarket = walletMarkets[0].market_cid;
  const checkQuery = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT m.market_id_cid AS market_cid
        FROM cascadian_clean.token_condition_market_map AS m
        INNER JOIN cascadian_clean.vw_resolutions_truth AS r
          ON r.condition_id_32b = m.condition_id_32b
      )
      SELECT
        '${firstMarket}' as test_market,
        if('${firstMarket}' IN (SELECT market_cid FROM resolved_markets), 'YES', 'NO') as is_resolved
    `,
    format: 'JSONEachRow',
  });
  const checkData = await checkQuery.json<any>();
  console.log(`   Is ${firstMarket} in resolved_markets? ${checkData[0].is_resolved}`);

  // Step 4: Try with lower() normalization
  console.log('\n4️⃣ Testing with lower() normalization...');
  const lowerQuery = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT m.market_id_cid AS market_cid
        FROM cascadian_clean.token_condition_market_map AS m
        INNER JOIN cascadian_clean.vw_resolutions_truth AS r
          ON lower(r.condition_id_32b) = lower(m.condition_id_32b)
      )
      SELECT
        '${firstMarket}' as test_market,
        if('${firstMarket}' IN (SELECT market_cid FROM resolved_markets), 'YES', 'NO') as is_resolved
    `,
    format: 'JSONEachRow',
  });
  const lowerData = await lowerQuery.json<any>();
  console.log(`   Is ${firstMarket} in resolved_markets (with lower())? ${lowerData[0].is_resolved}`);

  // Step 5: Check total count of resolutions in vw_resolutions_truth
  console.log('\n5️⃣ Checking vw_resolutions_truth coverage...');
  const truthQuery = await ch.query({
    query: `
      SELECT count() as total_resolutions
      FROM cascadian_clean.vw_resolutions_truth
    `,
    format: 'JSONEachRow',
  });
  const truthData = await truthQuery.json<any>();
  console.log(`   Total resolutions in vw_resolutions_truth: ${truthData[0].total_resolutions}`);

  console.log('\n================================================================================');
  console.log('✅ TEST COMPLETE');
  console.log('================================================================================');

  await ch.close();
}

testCTE().catch(console.error);
