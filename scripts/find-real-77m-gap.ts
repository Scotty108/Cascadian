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

async function findGap() {
  console.log('\n🔍 FINDING THE REAL 77M GAP');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Understanding the tables:');
  console.log('   trades_raw: 160.9M rows (buggy CLOB import)');
  console.log('   vw_trades_canonical: 157.5M rows (materialized table)');
  console.log('   trades_with_direction: 82.1M rows (blockchain-derived)\n');
  console.log('   GAP: 160.9M - 82.1M = 78.8M missing trades');

  console.log('\n2️⃣ Where is the user seeing these 77M missing trades?');
  console.log('   Let me check the ACTUAL difference between tables...\n');

  console.log('3️⃣ Option A: Gap is trades_raw → trades_with_direction');
  const optionA = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count() as total,
        count(DISTINCT transaction_hash) as unique_txs
      FROM trades_raw
      
      UNION ALL
      
      SELECT
        'trades_with_direction' as source,
        count() as total,
        count(DISTINCT tx_hash) as unique_txs
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  console.log(await optionA.json());
  console.log('   Gap: 160.9M - 82.1M = 78.8M rows\n');

  console.log('4️⃣ Of those 78.8M, how many have usable data?');
  console.log('   Checking for real trades that could be blockchain-recovered...\n');
  
  const recoverableCheck = await client.query({
    query: `
      SELECT
        count() as only_in_raw,
        countIf(condition_id != '' AND length(condition_id) >= 64) as has_condition_id,
        countIf(market_id != '0x0000000000000000000000000000000000000000000000000000000000000000' AND market_id != '12' AND market_id != '') as has_market_id,
        countIf(transaction_hash != '' AND length(transaction_hash) = 66) as has_tx_hash,
        
        -- Could we blockchain-recover these?
        countIf(
          transaction_hash != '' 
          AND length(transaction_hash) = 66
          AND usd_value > 0
        ) as blockchain_recoverable,
        
        sum(usd_value) as total_volume
        
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM trades_with_direction
      )
    `,
    format: 'JSONEachRow',
  });
  const recData: any = (await recoverableCheck.json())[0];
  console.log(`   Rows only in trades_raw: ${parseInt(recData.only_in_raw).toLocaleString()}`);
  console.log(`   Has condition_id: ${parseInt(recData.has_condition_id).toLocaleString()} (${(recData.has_condition_id * 100 / recData.only_in_raw).toFixed(1)}%)`);
  console.log(`   Has market_id: ${parseInt(recData.has_market_id).toLocaleString()} (${(recData.has_market_id * 100 / recData.only_in_raw).toFixed(1)}%)`);
  console.log(`   Has tx_hash: ${parseInt(recData.has_tx_hash).toLocaleString()} (${(recData.has_tx_hash * 100 / recData.only_in_raw).toFixed(1)}%)`);
  console.log(`   \n   🎯 BLOCKCHAIN RECOVERABLE: ${parseInt(recData.blockchain_recoverable).toLocaleString()} (${(recData.blockchain_recoverable * 100 / recData.only_in_raw).toFixed(1)}%)`);
  console.log(`   Volume: $${parseFloat(recData.total_volume).toLocaleString()}\n`);

  console.log('5️⃣ Sample potentially recoverable trades:');
  const sample = await client.query({
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
        AND transaction_hash != ''
        AND length(transaction_hash) = 66
        AND usd_value > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n6️⃣ CRITICAL QUESTION: Is the blockchain backfill recovering these?');
  console.log('   The backfill is scanning blockchain for ERC1155 transfers using tx_hashes.');
  console.log('   If those 1.47M trades have valid tx_hashes, they CAN be recovered!\n');

  console.log('7️⃣ What about the remaining 76.4M - 1.47M = ~75M trades?');
  const remainingCheck = await client.query({
    query: `
      SELECT
        count() as remaining_trades,
        avg(usd_value) as avg_value,
        sum(usd_value) as total_volume,
        countIf(trade_id LIKE '%undefined%') as has_undefined
      FROM trades_raw
      WHERE transaction_hash NOT IN (SELECT DISTINCT tx_hash FROM trades_with_direction)
        AND NOT (transaction_hash != '' AND length(transaction_hash) = 66 AND usd_value > 0)
    `,
    format: 'JSONEachRow',
  });
  const remData: any = (await remainingCheck.json())[0];
  console.log(`   Remaining non-recoverable: ${parseInt(remData.remaining_trades).toLocaleString()}`);
  console.log(`   Avg value: $${parseFloat(remData.avg_value).toFixed(2)}`);
  console.log(`   Total volume: $${parseFloat(remData.total_volume).toLocaleString()}`);
  console.log(`   Has "undefined": ${parseInt(remData.has_undefined).toLocaleString()} (${(remData.has_undefined * 100 / remData.remaining_trades).toFixed(1)}%)`);
  console.log('\n   These are likely phantom/corrupted records.\n');

  await client.close();
}

findGap().catch(console.error);
