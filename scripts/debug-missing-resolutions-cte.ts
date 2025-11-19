#!/usr/bin/env tsx
/**
 * Debug the CTE logic to find where the 171k missing markets went
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function debugMissingCTE() {
  console.log('\n🐛 DEBUGGING MISSING RESOLUTIONS CTE\n');
  console.log('=' .repeat(80));

  // 1. Count resolutions with valid winners
  console.log('\n1️⃣ RESOLUTIONS WITH VALID WINNERS');
  console.log('-'.repeat(80));

  const validResolutions = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id_norm) as unique_cids,
        COUNT(DISTINCT lower('0x' || toString(condition_id_norm))) as unique_normalized
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });

  const validRes = await validResolutions.json<any>();
  console.log('\nmarket_resolutions_final (valid winners):');
  console.log(`  Total rows: ${validRes[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs: ${validRes[0].unique_cids.toLocaleString()}`);
  console.log(`  Unique normalized: ${validRes[0].unique_normalized.toLocaleString()}`);

  // 2. Count unique trade CIDs
  console.log('\n2️⃣ UNIQUE TRADE CIDs');
  console.log('-'.repeat(80));

  const tradeCids = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT cid_hex) as unique_cids
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
    `,
    format: 'JSONEachRow'
  });

  const tradeRes = await tradeCids.json<any>();
  console.log(`\nfact_trades_clean: ${tradeRes[0].unique_cids.toLocaleString()} unique CIDs`);

  // 3. Check the LEFT JOIN explicitly
  console.log('\n3️⃣ LEFT JOIN RESULT (Step by step)');
  console.log('-'.repeat(80));

  const leftJoinTest = await client.query({
    query: `
      WITH resolutions AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL AND payout_denominator > 0
      ),
      trades AS (
        SELECT DISTINCT cid_hex
        FROM cascadian_clean.fact_trades_clean
        WHERE cid_hex != ''
      )
      SELECT
        COUNT(*) as total_trade_cids,
        SUM(CASE WHEN r.cid_hex IS NULL THEN 1 ELSE 0 END) as missing_resolutions,
        SUM(CASE WHEN r.cid_hex IS NOT NULL THEN 1 ELSE 0 END) as have_resolutions
      FROM trades t
      LEFT JOIN resolutions r ON t.cid_hex = r.cid_hex
    `,
    format: 'JSONEachRow'
  });

  const leftJoin = await leftJoinTest.json<any>();
  console.log('\nLEFT JOIN result:');
  console.log(`  Total trade CIDs: ${leftJoin[0].total_trade_cids.toLocaleString()}`);
  console.log(`  Have resolutions: ${leftJoin[0].have_resolutions.toLocaleString()}`);
  console.log(`  Missing resolutions: ${leftJoin[0].missing_resolutions.toLocaleString()}`);

  // 4. Sample some missing CIDs
  if (leftJoin[0].missing_resolutions > 0) {
    console.log('\n4️⃣ SAMPLE MISSING CIDs');
    console.log('-'.repeat(80));

    const sampleMissing = await client.query({
      query: `
        WITH resolutions AS (
          SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL AND payout_denominator > 0
        ),
        trades AS (
          SELECT cid_hex, COUNT(*) as trade_count
          FROM cascadian_clean.fact_trades_clean
          WHERE cid_hex != ''
          GROUP BY cid_hex
        )
        SELECT
          t.cid_hex,
          t.trade_count
        FROM trades t
        LEFT JOIN resolutions r ON t.cid_hex = r.cid_hex
        WHERE r.cid_hex IS NULL
        ORDER BY t.trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const missing = await sampleMissing.json<any>();
    console.log('\nTop 10 missing CIDs by trade count:');
    missing.forEach((row: any, idx: number) => {
      console.log(`  ${idx + 1}. ${row.cid_hex} (${row.trade_count.toLocaleString()} trades)`);
    });

    // 5. Check if these exist in gamma_markets
    console.log('\n5️⃣ CHECK IF MISSING CIDs ARE IN GAMMA_MARKETS');
    console.log('-'.repeat(80));

    const gammaCheck = await client.query({
      query: `
        WITH resolutions AS (
          SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL AND payout_denominator > 0
        ),
        trades AS (
          SELECT DISTINCT cid_hex
          FROM cascadian_clean.fact_trades_clean
          WHERE cid_hex != ''
        ),
        missing AS (
          SELECT t.cid_hex
          FROM trades t
          LEFT JOIN resolutions r ON t.cid_hex = r.cid_hex
          WHERE r.cid_hex IS NULL
        ),
        gamma AS (
          SELECT DISTINCT lower(condition_id) as cid_hex
          FROM default.gamma_markets
          WHERE condition_id != ''
        )
        SELECT
          COUNT(*) as total_missing,
          SUM(CASE WHEN g.cid_hex IS NOT NULL THEN 1 ELSE 0 END) as found_in_gamma
        FROM missing m
        LEFT JOIN gamma g ON m.cid_hex = g.cid_hex
      `,
      format: 'JSONEachRow'
    });

    const gamma = await gammaCheck.json<any>();
    console.log(`\nMissing resolutions: ${gamma[0].total_missing.toLocaleString()}`);
    console.log(`Found in gamma_markets: ${gamma[0].found_in_gamma.toLocaleString()}`);
    console.log(`Still missing: ${(gamma[0].total_missing - gamma[0].found_in_gamma).toLocaleString()}`);
  } else {
    console.log('\n✅ No missing resolutions found! All trades have resolution data.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ DEBUG COMPLETE\n');

  await client.close();
}

debugMissingCTE().catch(console.error);
