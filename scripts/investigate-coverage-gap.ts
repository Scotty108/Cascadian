#!/usr/bin/env npx tsx
/**
 * CRITICAL: Investigate the 78M missing trade gap
 * 
 * This script will determine:
 * 1. How many trades are in trades_raw but NOT in trades_with_direction?
 * 2. Of those missing trades, how many are real vs phantom?
 * 3. Can we recover them from blockchain?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function investigateGap() {
  console.log('\n🔍 CRITICAL INVESTIGATION: 78M Missing Trade Gap');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Table sizes:');
  const sizes = await client.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_raw', 'trades_with_direction')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await sizes.json());

  console.log('\n2️⃣ Unique transaction hashes:');
  const txCounts = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count(DISTINCT tx_hash) as unique_txs
      FROM trades_raw
      
      UNION ALL
      
      SELECT
        'trades_with_direction' as source,
        count(DISTINCT tx_hash) as unique_txs
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  console.log(await txCounts.json());

  console.log('\n3️⃣ CRITICAL: Market ID quality in trades_with_direction:');
  const marketQuality = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(market_id != '') as has_market_id,
        countIf(market_id = '') as blank_market_id,
        countIf(market_id = '12') as market_id_is_12,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as market_id_is_zeros,
        countIf(length(market_id) > 10 AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000' AND market_id != '12') as valid_market_id
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  console.log(await marketQuality.json());

  console.log('\n4️⃣ Sample trades_with_direction with BAD market_ids:');
  const badMarkets = await client.query({
    query: `
      SELECT
        tx_hash,
        wallet_address,
        market_id,
        condition_id_norm,
        usd_value
      FROM trades_with_direction
      WHERE market_id = '' OR market_id = '12' OR market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await badMarkets.json());

  console.log('\n5️⃣ What percentage of volume is affected by bad market_ids?');
  const volumeImpact = await client.query({
    query: `
      SELECT
        sum(usd_value) as total_volume,
        sumIf(usd_value, market_id = '' OR market_id = '12' OR market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as bad_market_volume,
        bad_market_volume * 100.0 / total_volume as bad_pct
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  console.log(await volumeImpact.json());

  console.log('\n6️⃣ CRITICAL: How many trades are MISSING from trades_with_direction?');
  console.log('   (This query will take ~60 seconds...)');
  
  const gapAnalysis = await client.query({
    query: `
      SELECT
        count() as trades_only_in_raw,
        count(DISTINCT tx_hash) as unique_tx_only_in_raw
      FROM trades_raw
      WHERE tx_hash NOT IN (
        SELECT DISTINCT tx_hash 
        FROM trades_with_direction
      )
    `,
    format: 'JSONEachRow',
  });
  const gap: any = (await gapAnalysis.json())[0];
  console.log(`   Trades in trades_raw but NOT in trades_with_direction: ${parseInt(gap.trades_only_in_raw).toLocaleString()}`);
  console.log(`   Unique transactions: ${parseInt(gap.unique_tx_only_in_raw).toLocaleString()}`);

  console.log('\n7️⃣ CRITICAL: Are those missing trades REAL or PHANTOM?');
  console.log('   Checking data quality of missing trades...');
  
  const missingQuality = await client.query({
    query: `
      WITH missing_trades AS (
        SELECT *
        FROM trades_raw
        WHERE tx_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction
        )
      )
      SELECT
        count() as total_missing,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as has_zero_market_id,
        countIf(market_id = '12') as has_twelve_market_id,
        countIf(maker = 'unidentified' OR taker = 'unidentified') as has_unidentified_parties,
        countIf(amount_usd > 0) as has_nonzero_volume,
        countIf(
          market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND market_id != '12'
          AND maker != 'unidentified'
          AND taker != 'unidentified'
          AND amount_usd > 0
        ) as looks_real
      FROM missing_trades
    `,
    format: 'JSONEachRow',
  });
  const quality: any = (await missingQuality.json())[0];
  console.log(`   Total missing: ${parseInt(quality.total_missing).toLocaleString()}`);
  console.log(`   Has zero market_id: ${parseInt(quality.has_zero_market_id).toLocaleString()} (${(quality.has_zero_market_id * 100 / quality.total_missing).toFixed(1)}%)`);
  console.log(`   Has "12" market_id: ${parseInt(quality.has_twelve_market_id).toLocaleString()} (${(quality.has_twelve_market_id * 100 / quality.total_missing).toFixed(1)}%)`);
  console.log(`   Has unidentified parties: ${parseInt(quality.has_unidentified_parties).toLocaleString()} (${(quality.has_unidentified_parties * 100 / quality.total_missing).toFixed(1)}%)`);
  console.log(`   Has non-zero volume: ${parseInt(quality.has_nonzero_volume).toLocaleString()} (${(quality.has_nonzero_volume * 100 / quality.total_missing).toFixed(1)}%)`);
  console.log(`   \n   ⚠️  LOOKS REAL: ${parseInt(quality.looks_real).toLocaleString()} (${(quality.looks_real * 100 / quality.total_missing).toFixed(1)}%)`);

  console.log('\n8️⃣ Sample "missing" trades that LOOK REAL:');
  const realMissing = await client.query({
    query: `
      SELECT
        tx_hash,
        wallet_address,
        market_id,
        amount_usd,
        maker,
        taker,
        timestamp
      FROM trades_raw
      WHERE tx_hash NOT IN (SELECT DISTINCT tx_hash FROM trades_with_direction)
        AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND market_id != '12'
        AND maker != 'unidentified'
        AND amount_usd > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await realMissing.json());

  await client.close();
}

investigateGap().catch(console.error);
