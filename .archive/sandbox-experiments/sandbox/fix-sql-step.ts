import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SCALE = 1000000;

async function testHexConversion() {
  console.log('🔧 Testing hex conversion step-by-step...');

  try {
    // Test 1: Simple hex conversion
    console.log('\n1. Testing basic hex conversion...');
    const test1 = await clickhouse.query({
      query: `
        SELECT
          '16304215772617610170532007143607044244073457766307645004057318774399348905304' AS decimal_str,
          lower(hex(toUInt256('16304215772617610170532007143607044244073457766307645004057318774399348905304'))) AS hex_str
      `,
      format: 'JSONEachRow'
    });
    const test1Data = await test1.json();
    console.log('Hex conversion result:', test1Data[0].hex_str.slice(0, 30));

    // Test 2: Token mapping with hex conversion
    console.log('\n2. Testing token mapping process...');
    const test2 = await clickhouse.query({
      query: `
        WITH hex_tokens AS (
          SELECT DISTINCT
            CAST(asset_id AS String) AS token_decimal,
            lower(hex(toUInt256(asset_id))) AS token_hex,
            side
          FROM default.clob_fills
          WHERE lower(proxy_wallet) = lower('${WALLET}')
             OR lower(user_eoa) = lower('${WALLET}')
          LIMIT 5
        ),
        mapped AS (
          SELECT
            h.token_decimal,
            h.token_hex,
            t.condition_id_64,
            t.outcome_idx,
            CAST(h.side AS String) as side
          FROM hex_tokens h
          LEFT JOIN sandbox.token_cid_map t
            ON t.token_hex = h.token_hex
        )
        SELECT * FROM mapped ORDER BY token_hex
      `,
      format: 'JSONEachRow'
    });
    const test2Data = await test2.json();

    console.log('Token mapping results:');
    test2Data.forEach((row: any) => {
      const mapped = row.condition_id_64 ? '✅ MAPPED' : '❌ UNMAPPED';
      console.log(`  ${row.token_decimal.slice(0, 10)}... → ${row.token_hex.slice(0, 15)}... ${mapped}`);
    });

    // Test 3: Complete simplified query
    console.log('\n3. Testing simplified complete query...');
    const test3 = await clickhouse.query({
      query: `
        WITH source AS (
          SELECT
            CASE
              WHEN proxy_wallet != '' THEN lower(CAST(proxy_wallet AS String))
              ELSE lower(CAST(user_eoa AS String))
            END AS wallet,
            CAST(asset_id AS String) AS token_decimal,
            CAST(side AS String) AS side,
            size / ${SCALE} AS qty,
            price / 1 AS px,
            (size / ${SCALE}) * (fee_rate_bps / 10000.0) AS fee,
            timestamp,
            CAST(asset_id AS String) AS tx_hash_placehold,
            market_slug,
            condition_id,
            outcome
          FROM default.clob_fills
          WHERE (
            lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
            OR lower(CAST(user_eoa AS String)) = lower('${WALLET}')
          )
          LIMIT 10
        ),
        converted AS (
          SELECT
            wallet,
            token_decimal,
            CAST(lower(hex(toUInt256(token_decimal))) AS String) AS token_hex,
            side,
            qty,
            px,
            fee,
            timestamp,
            tx_hash_placehold,
            market_slug,
            condition_id,
            outcome
          FROM source
        )
        SELECT * FROM converted ORDER BY timestamp
      `,
      format: 'JSONEachRow'
    });
    const test3Data = await test3.json();

    console.log(`✅ Test successful! Found ${test3Data.length} trades with hex conversion`);
    if (test3Data.length > 0) {
      console.log(`Example: ${test3Data[0].token_decimal.slice(0, 10)}... → ${test3Data[0].token_hex.slice(0, 15)}...`);
    }

    // Now create a working version of the table
    console.log('\n4. Creating working fills_norm_fixed table...');
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.fills_norm_fixed_v1 (
          wallet String,
          token_decimal String,
          token_hex String,
          side LowCardinality(String),
          qty Float64,
          px Float64,
          fee Float64,
          timestamp DateTime,
          tx_hash String
        )
        ENGINE = MergeTree()
        ORDER BY (wallet, token_hex, timestamp)
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    await clickhouse.query({
      query: `
        INSERT INTO sandbox.fills_norm_fixed_v1
        SELECT
          CASE
            WHEN proxy_wallet != '' THEN lower(CAST(proxy_wallet AS String))
            ELSE lower(CAST(user_eoa AS String))
          END AS wallet,
          CAST(asset_id AS String) AS token_decimal,
          lower(hex(toUInt256(asset_id))) AS token_hex,
          CAST(side AS String) AS side,
          size / ${SCALE} AS qty,
          price / 1 AS px,
          (size / ${SCALE}) * (fee_rate_bps / 10000.0) AS fee,
          timestamp,
          tx_hash
        FROM default.clob_fills
        WHERE (
          lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
          OR lower(CAST(user_eoa AS String)) = lower('${WALLET}')
        )
      `,
      format: 'JSONEachRow'
    });

    // Check results
    const finalCheck = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          countDistinct(token_hex) as unique_tokens,
          side,
          count() as cnt
        FROM sandbox.fills_norm_fixed_v1
        GROUP BY side
        ORDER BY side
      `,
      format: 'JSONEachRow'
    });
    const finalData = await finalCheck.json();

    console.log(`✅ Success! Created table with ${finalData[0].total} trades`);
    console.log(`  Found ${finalData[0].unique_tokens} unique token hex values`);
    finalData.forEach((row: any) => {
      console.log(`  ${row.side}: ${row.cnt} trades`);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

testHexConversion().catch(console.error);