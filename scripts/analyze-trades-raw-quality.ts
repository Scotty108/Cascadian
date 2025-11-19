#!/usr/bin/env npx tsx
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

async function analyzeQuality() {
  console.log('\n🚨 CRITICAL: Analyzing trades_raw data quality');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Data corruption indicators:');
  const corruption = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as zero_market_id,
        countIf(market_id = '12') as twelve_market_id,
        countIf(condition_id = '') as empty_condition_id,
        countIf(wallet_address = '0x00000000000050ba7c429821e6d66429452ba168') as default_wallet,
        countIf(tx_timestamp = '1970-01-01 00:00:00') as epoch_zero_timestamp,
        countIf(trade_id LIKE '%undefined%') as has_undefined_in_id,
        
        -- How many look REAL?
        countIf(
          market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND market_id != '12'
          AND condition_id != ''
          AND wallet_address != '0x00000000000050ba7c429821e6d66429452ba168'
        ) as looks_real
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  });
  const data: any = (await corruption.json())[0];
  console.log(`   Total rows: ${parseInt(data.total_rows).toLocaleString()}`);
  console.log(`   Zero market_id: ${parseInt(data.zero_market_id).toLocaleString()} (${(data.zero_market_id * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`   "12" market_id: ${parseInt(data.twelve_market_id).toLocaleString()} (${(data.twelve_market_id * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`   Empty condition_id: ${parseInt(data.empty_condition_id).toLocaleString()} (${(data.empty_condition_id * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`   Default wallet: ${parseInt(data.default_wallet).toLocaleString()} (${(data.default_wallet * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`   Epoch zero timestamp: ${parseInt(data.epoch_zero_timestamp).toLocaleString()} (${(data.epoch_zero_timestamp * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`   Has "undefined" in ID: ${parseInt(data.has_undefined_in_id).toLocaleString()} (${(data.has_undefined_in_id * 100 / data.total_rows).toFixed(1)}%)`);
  console.log(`\n   ✅ LOOKS REAL: ${parseInt(data.looks_real).toLocaleString()} (${(data.looks_real * 100 / data.total_rows).toFixed(1)}%)`);

  console.log('\n2️⃣ Unique transaction hashes:');
  const txCounts = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count(DISTINCT transaction_hash) as unique_txs
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

  console.log('\n3️⃣ CRITICAL: Gap analysis (trades in raw but not in direction):');
  console.log('   (This may take 60-90 seconds...)');
  
  const gap = await client.query({
    query: `
      SELECT
        count() as only_in_raw,
        count(DISTINCT transaction_hash) as unique_tx_only_in_raw,
        
        -- Of those missing, how many look real?
        countIf(
          market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND market_id != '12'
          AND condition_id != ''
        ) as missing_but_looks_real,
        
        -- Of those missing, how many are corrupted?
        countIf(
          market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
          OR market_id = '12'
          OR condition_id = ''
        ) as missing_and_corrupted
        
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash 
        FROM trades_with_direction
      )
    `,
    format: 'JSONEachRow',
  });
  const gapData: any = (await gap.json())[0];
  console.log(`   Rows only in trades_raw: ${parseInt(gapData.only_in_raw).toLocaleString()}`);
  console.log(`   Unique transactions: ${parseInt(gapData.unique_tx_only_in_raw).toLocaleString()}`);
  console.log(`\n   Missing but LOOKS REAL: ${parseInt(gapData.missing_but_looks_real).toLocaleString()} (${(gapData.missing_but_looks_real * 100 / gapData.only_in_raw).toFixed(1)}%)`);
  console.log(`   Missing and CORRUPTED: ${parseInt(gapData.missing_and_corrupted).toLocaleString()} (${(gapData.missing_and_corrupted * 100 / gapData.only_in_raw).toFixed(1)}%)`);

  console.log('\n4️⃣ Sample of "missing but looks real" trades:');
  const realMissing = await client.query({
    query: `
      SELECT
        transaction_hash,
        wallet_address,
        market_id,
        condition_id,
        usd_value,
        timestamp
      FROM trades_raw
      WHERE transaction_hash NOT IN (SELECT DISTINCT tx_hash FROM trades_with_direction)
        AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND market_id != '12'
        AND condition_id != ''
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await realMissing.json());

  console.log('\n5️⃣ Volume analysis:');
  const volume = await client.query({
    query: `
      SELECT
        sum(usd_value) as total_volume,
        sumIf(usd_value, market_id = '0x0000000000000000000000000000000000000000000000000000000000000000' OR market_id = '12' OR condition_id = '') as corrupted_volume,
        sumIf(usd_value, market_id != '0x0000000000000000000000000000000000000000000000000000000000000000' AND market_id != '12' AND condition_id != '') as real_volume
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  });
  const volData: any = (await volume.json())[0];
  console.log(`   Total volume: $${parseFloat(volData.total_volume).toLocaleString()}`);
  console.log(`   Corrupted rows volume: $${parseFloat(volData.corrupted_volume).toLocaleString()} (${(volData.corrupted_volume * 100 / volData.total_volume).toFixed(1)}%)`);
  console.log(`   Real-looking rows volume: $${parseFloat(volData.real_volume).toLocaleString()} (${(volData.real_volume * 100 / volData.total_volume).toFixed(1)}%)`);

  await client.close();
}

analyzeQuality().catch(console.error);
