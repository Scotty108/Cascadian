#!/usr/bin/env tsx
/**
 * Step 2: Trace wallet 0x4ce7's trades through vw_trades_canonical
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

const TEST_WALLET = '4ce73141dbfce41e65db3723e31059a730f0abad';

async function traceWalletTrades() {
  console.log('================================================================================');
  console.log(`📊 STEP 2: TRACE WALLET ${TEST_WALLET} TRADES`);
  console.log('================================================================================\n');

  // 1. Check if vw_trades_canonical exists
  console.log('1️⃣ Checking vw_trades_canonical view...');
  try {
    const viewExists = await ch.query({
      query: `SELECT count() as cnt FROM default.vw_trades_canonical WHERE wallet_address = '${TEST_WALLET}' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const viewData = await viewExists.json<any>();
    console.log(`   ✅ View exists, wallet has ${viewData[0].cnt} trades`);
  } catch (e: any) {
    console.log(`   ❌ View does not exist: ${e.message}`);
    console.log('   Trying fact_trades instead...');
  }

  // 2. Check fact_trades for wallet
  console.log('\n2️⃣ Checking fact_trades for wallet...');
  const tradesCheck = await ch.query({
    query: `
      SELECT
        count() as total_trades,
        count(DISTINCT condition_id) as unique_conditions,
        count(DISTINCT tx_hash) as unique_txs,
        countIf(condition_id != '') as with_condition_id,
        countIf(condition_id = '') as missing_condition_id,
        sum(usdc_amount) as total_usdc_volume,
        min(block_timestamp) as first_trade,
        max(block_timestamp) as last_trade
      FROM default.fact_trades
      WHERE wallet_address = '${TEST_WALLET}'
    `,
    format: 'JSONEachRow',
  });
  const tradesData = await tradesCheck.json<any>();
  console.log('   Total trades:', tradesData[0].total_trades);
  console.log('   Unique conditions:', tradesData[0].unique_conditions);
  console.log('   Unique transactions:', tradesData[0].unique_txs);
  console.log('   With condition_id:', tradesData[0].with_condition_id);
  console.log('   Missing condition_id:', tradesData[0].missing_condition_id);
  console.log('   Total USDC volume:', tradesData[0].total_usdc_volume);
  console.log('   Date range:', tradesData[0].first_trade, 'to', tradesData[0].last_trade);

  // 3. Sample trades with condition_ids
  console.log('\n3️⃣ Sample trades (first 10)...');
  const sampleTrades = await ch.query({
    query: `
      SELECT
        tx_hash,
        block_timestamp,
        condition_id,
        side,
        token_amount,
        usdc_amount,
        price
      FROM default.fact_trades
      WHERE wallet_address = '${TEST_WALLET}'
      ORDER BY block_timestamp DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const sampleData = await sampleTrades.json<any>();
  sampleData.forEach((trade: any, idx: number) => {
    console.log(`\n   Trade ${idx + 1}:`);
    console.log(`     TX: ${trade.tx_hash}`);
    console.log(`     Time: ${trade.block_timestamp}`);
    console.log(`     Condition: ${trade.condition_id || '(EMPTY)'}`);
    console.log(`     Side: ${trade.side}`);
    console.log(`     Tokens: ${trade.token_amount}`);
    console.log(`     USDC: ${trade.usdc_amount}`);
    console.log(`     Price: ${trade.price}`);
  });

  // 4. Check condition_id quality
  console.log('\n4️⃣ Checking condition_id quality...');
  const idQuality = await ch.query({
    query: `
      SELECT
        countIf(length(condition_id) = 64) as proper_format,
        countIf(length(condition_id) > 0 AND length(condition_id) != 64) as wrong_length,
        countIf(condition_id = '') as empty,
        countIf(condition_id = '0' OR condition_id = '00000000000000000000000000000000000000000000000000000000000000') as zero_ids
      FROM default.fact_trades
      WHERE wallet_address = '${TEST_WALLET}'
    `,
    format: 'JSONEachRow',
  });
  const qualityData = await idQuality.json<any>();
  console.log('   Proper format (64 chars):', qualityData[0].proper_format);
  console.log('   Wrong length:', qualityData[0].wrong_length);
  console.log('   Empty:', qualityData[0].empty);
  console.log('   Zero IDs:', qualityData[0].zero_ids);

  // 5. Check how many trades match to resolutions
  console.log('\n5️⃣ Checking resolution join coverage...');
  const resolutionJoin = await ch.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(r.condition_id_norm IS NOT NULL) as matched_to_resolution,
        countIf(r.condition_id_norm IS NULL) as no_resolution
      FROM default.fact_trades t
      LEFT JOIN default.vw_resolutions_truth r
        ON t.condition_id = r.condition_id_norm
      WHERE t.wallet_address = '${TEST_WALLET}'
        AND t.condition_id != ''
    `,
    format: 'JSONEachRow',
  });
  const joinData = await resolutionJoin.json<any>();
  console.log('   Total trades with condition_id:', joinData[0].total_trades);
  console.log('   Matched to resolution:', joinData[0].matched_to_resolution);
  console.log('   No resolution found:', joinData[0].no_resolution);
  const matchRate = (joinData[0].matched_to_resolution / joinData[0].total_trades) * 100;
  console.log(`   Match rate: ${matchRate.toFixed(2)}%`);

  // 6. Sample unmatched conditions
  if (parseInt(joinData[0].no_resolution) > 0) {
    console.log('\n6️⃣ Sample unmatched conditions (first 5)...');
    const unmatchedSample = await ch.query({
      query: `
        SELECT DISTINCT
          t.condition_id,
          count() as trade_count,
          sum(t.usdc_amount) as total_volume
        FROM default.fact_trades t
        LEFT JOIN default.vw_resolutions_truth r
          ON t.condition_id = r.condition_id_norm
        WHERE t.wallet_address = '${TEST_WALLET}'
          AND t.condition_id != ''
          AND r.condition_id_norm IS NULL
        GROUP BY t.condition_id
        ORDER BY total_volume DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const unmatchedData = await unmatchedSample.json<any>();
    unmatchedData.forEach((row: any, idx: number) => {
      console.log(`   ${idx + 1}. ${row.condition_id} - ${row.trade_count} trades, $${row.total_volume} volume`);
    });
  }

  console.log('\n================================================================================');
  console.log('✅ STEP 2 COMPLETE - WALLET TRADES TRACED');
  console.log('================================================================================');

  await ch.close();
}

traceWalletTrades().catch(console.error);
