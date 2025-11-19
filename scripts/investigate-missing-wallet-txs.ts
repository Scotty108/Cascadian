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

async function investigateMissing() {
  console.log('\n🚨 INVESTIGATING MISSING WALLET TRANSACTIONS');
  console.log('='.repeat(80));
  
  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';
  console.log(`\nFocusing on wallet: ${topWallet}`);
  console.log('Missing: 638,522 transactions\n');

  console.log('1️⃣ Quality of "missing" transactions for this wallet:');
  const quality = await client.query({
    query: `
      SELECT
        count() as missing_txs,
        count(DISTINCT transaction_hash) as unique_missing_txs,
        countIf(condition_id = '') as blank_condition_id,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as zero_market_id,
        countIf(market_id = '12') as twelve_market_id,
        countIf(trade_id LIKE '%undefined%') as has_undefined,
        countIf(usd_value > 0) as has_value,
        sum(usd_value) as total_volume
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction 
          WHERE wallet_address = {wallet:String}
        )
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const qualityData: any = (await quality.json())[0];
  console.log(`   Missing rows: ${parseInt(qualityData.missing_txs).toLocaleString()}`);
  console.log(`   Unique tx_hashes: ${parseInt(qualityData.unique_missing_txs).toLocaleString()}`);
  console.log(`   Blank condition_id: ${parseInt(qualityData.blank_condition_id).toLocaleString()} (${(qualityData.blank_condition_id * 100 / qualityData.missing_txs).toFixed(1)}%)`);
  console.log(`   Zero market_id: ${parseInt(qualityData.zero_market_id).toLocaleString()} (${(qualityData.zero_market_id * 100 / qualityData.missing_txs).toFixed(1)}%)`);
  console.log(`   "12" market_id: ${parseInt(qualityData.twelve_market_id).toLocaleString()} (${(qualityData.twelve_market_id * 100 / qualityData.missing_txs).toFixed(1)}%)`);
  console.log(`   Has "undefined": ${parseInt(qualityData.has_undefined).toLocaleString()} (${(qualityData.has_undefined * 100 / qualityData.missing_txs).toFixed(1)}%)`);
  console.log(`   Has value > 0: ${parseInt(qualityData.has_value).toLocaleString()} (${(qualityData.has_value * 100 / qualityData.missing_txs).toFixed(1)}%)`);
  console.log(`   Total volume: $${parseFloat(qualityData.total_volume).toLocaleString()}\n`);

  console.log('2️⃣ Sample of "missing" transactions:');
  const sample = await client.query({
    query: `
      SELECT
        transaction_hash,
        trade_id,
        condition_id,
        market_id,
        usd_value,
        timestamp
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction 
          WHERE wallet_address = {wallet:String}
        )
      LIMIT 10
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n3️⃣ ARE THESE REAL? Checking if tx_hashes exist on blockchain...');
  const txCheck = await client.query({
    query: `
      SELECT
        count(DISTINCT r.transaction_hash) as missing_unique_txs,
        count(DISTINCT e.tx_hash) as found_on_blockchain,
        found_on_blockchain * 100.0 / missing_unique_txs as blockchain_match_rate
      FROM trades_raw r
      LEFT JOIN erc1155_transfers e ON r.transaction_hash = e.tx_hash
      WHERE r.wallet_address = {wallet:String}
        AND r.transaction_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction 
          WHERE wallet_address = {wallet:String}
        )
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const txData: any = (await txCheck.json())[0];
  console.log(`   Missing unique txs: ${parseInt(txData.missing_unique_txs).toLocaleString()}`);
  console.log(`   Found on blockchain (in erc1155_transfers): ${parseInt(txData.found_on_blockchain).toLocaleString()}`);
  console.log(`   Blockchain match rate: ${parseFloat(txData.blockchain_match_rate).toFixed(1)}%\n`);

  console.log('4️⃣ CRITICAL: Can the blockchain backfill recover these?');
  console.log('   Checking if the running backfill is finding them...\n');
  
  console.log('5️⃣ Overall impact across ALL wallets:');
  const overall = await client.query({
    query: `
      SELECT
        count() as total_missing_rows,
        count(DISTINCT transaction_hash) as unique_missing_txs,
        countIf(condition_id = '') as blank_condition,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000' OR market_id = '12') as bad_market,
        sum(usd_value) as total_volume,
        
        blank_condition * 100.0 / total_missing_rows as blank_pct,
        bad_market * 100.0 / total_missing_rows as bad_market_pct
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM trades_with_direction
      )
    `,
    format: 'JSONEachRow',
  });
  const overallData: any = (await overall.json())[0];
  console.log(`   Total missing rows: ${parseInt(overallData.total_missing_rows).toLocaleString()}`);
  console.log(`   Unique missing txs: ${parseInt(overallData.unique_missing_txs).toLocaleString()}`);
  console.log(`   Blank condition_id: ${parseInt(overallData.blank_condition).toLocaleString()} (${parseFloat(overallData.blank_pct).toFixed(1)}%)`);
  console.log(`   Bad market_id: ${parseInt(overallData.bad_market).toLocaleString()} (${parseFloat(overallData.bad_market_pct).toFixed(1)}%)`);
  console.log(`   Total volume: $${parseFloat(overallData.total_volume).toLocaleString()}\n`);

  await client.close();
}

investigateMissing().catch(console.error);
