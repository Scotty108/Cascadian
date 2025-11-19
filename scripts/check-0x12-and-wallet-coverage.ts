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

async function runTests() {
  console.log('\n📋 TEST 1: Checking for "0x12" market IDs');
  console.log('='.repeat(80));

  // Check trades_with_direction
  const dir0x12 = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(market_id = '0x12') as is_0x12,
        countIf(market_id = '12') as is_12,
        countIf(market_id IN ('0x12', '12')) as either_format
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const dirData: any = (await dir0x12.json())[0];
  console.log('\ntrades_with_direction:');
  console.log(`  Total rows: ${parseInt(dirData.total).toLocaleString()}`);
  console.log(`  market_id = "0x12": ${parseInt(dirData.is_0x12).toLocaleString()}`);
  console.log(`  market_id = "12": ${parseInt(dirData.is_12).toLocaleString()}`);
  console.log(`  Either format: ${parseInt(dirData.either_format).toLocaleString()}`);

  // Check vw_trades_canonical
  const vw0x12 = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(market_id_norm = '0x12') as is_0x12,
        countIf(market_id_norm = '12') as is_12,
        countIf(market_id_norm IN ('0x12', '12')) as either_format
      FROM vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });
  const vwData: any = (await vw0x12.json())[0];
  console.log('\nvw_trades_canonical:');
  console.log(`  Total rows: ${parseInt(vwData.total).toLocaleString()}`);
  console.log(`  market_id_norm = "0x12": ${parseInt(vwData.is_0x12).toLocaleString()}`);
  console.log(`  market_id_norm = "12": ${parseInt(vwData.is_12).toLocaleString()}`);
  console.log(`  Either format: ${parseInt(vwData.either_format).toLocaleString()}`);

  console.log('\n\n🎯 TEST 2: WALLET-LEVEL COVERAGE TEST');
  console.log('='.repeat(80));
  console.log('Testing if ANY wallet is missing ANY transactions...\n');

  const walletTest = await client.query({
    query: `
      WITH wallet_tx_counts AS (
        SELECT
          wallet_address,
          count(DISTINCT transaction_hash) as txs_in_raw
        FROM trades_raw
        WHERE transaction_hash != ''
          AND length(transaction_hash) = 66
        GROUP BY wallet_address
      ),
      direction_tx_counts AS (
        SELECT
          wallet_address,
          count(DISTINCT tx_hash) as txs_in_direction
        FROM trades_with_direction
        GROUP BY wallet_address
      )
      SELECT
        r.wallet_address,
        r.txs_in_raw,
        COALESCE(d.txs_in_direction, 0) as txs_in_direction,
        r.txs_in_raw - COALESCE(d.txs_in_direction, 0) as missing_txs
      FROM wallet_tx_counts r
      LEFT JOIN direction_tx_counts d ON r.wallet_address = d.wallet_address
      WHERE missing_txs > 0
      ORDER BY missing_txs DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  
  const wallets = await walletTest.json();
  
  if (wallets.length === 0) {
    console.log('✅ PERFECT! No wallets are missing any transactions.');
    console.log('   trades_with_direction has COMPLETE coverage for all wallets.\n');
  } else {
    console.log(`⚠️  Found ${wallets.length} wallets with missing transactions:\n`);
    wallets.forEach((w: any, i: number) => {
      console.log(`   ${i+1}. ${w.wallet_address}`);
      console.log(`      trades_raw: ${w.txs_in_raw} txs`);
      console.log(`      trades_with_direction: ${w.txs_in_direction} txs`);
      console.log(`      Missing: ${w.missing_txs} txs\n`);
    });
  }

  console.log('\n\n🔍 TEST 3: Comparing to vw_trades_canonical');
  console.log('='.repeat(80));
  console.log('Checking which table has better coverage...\n');

  const comparison = await client.query({
    query: `
      SELECT
        'trades_with_direction' as source,
        count() as total_rows,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT tx_hash) as unique_txs,
        countIf(condition_id_norm != '' AND length(condition_id_norm) >= 64) as valid_condition_ids,
        countIf(market_id != '' AND market_id != '12' AND length(market_id) >= 20) as valid_market_ids
      FROM trades_with_direction
      
      UNION ALL
      
      SELECT
        'vw_trades_canonical' as source,
        count() as total_rows,
        count(DISTINCT wallet_address_norm) as unique_wallets,
        count(DISTINCT transaction_hash) as unique_txs,
        countIf(condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND length(condition_id_norm) >= 64) as valid_condition_ids,
        countIf(market_id_norm != '' AND market_id_norm != '0x' AND market_id_norm != '0x12' AND length(market_id_norm) >= 20) as valid_market_ids
      FROM vw_trades_canonical
      
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await comparison.json());

  console.log('\n\n📊 TEST 4: Which table has MORE valid trades?');
  console.log('='.repeat(80));
  
  const validCount = await client.query({
    query: `
      SELECT
        'trades_with_direction VALID' as source,
        count() as rows
      FROM trades_with_direction
      WHERE condition_id_norm != ''
        AND length(condition_id_norm) >= 64
      
      UNION ALL
      
      SELECT
        'vw_trades_canonical VALID' as source,
        count() as rows
      FROM vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND length(condition_id_norm) >= 64
      
      ORDER BY rows DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await validCount.json());

  await client.close();
}

runTests().catch(console.error);
