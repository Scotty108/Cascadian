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
  request_timeout: 600000,
});

async function traceMissingTxs() {
  console.log('\n🔍 TRACING "MISSING" TX_HASHES ACROSS ALL TABLES');
  console.log('='.repeat(80));
  
  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';
  console.log(`\nFocus wallet: ${topWallet}`);
  console.log('Missing from trades_with_direction: 638,522 tx_hashes\n');

  // First, let's get a sample of those missing tx_hashes
  console.log('1️⃣ Getting sample of missing tx_hashes...');
  const sampleTxs = await client.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND transaction_hash NOT IN (
          SELECT DISTINCT tx_hash 
          FROM trades_with_direction 
          WHERE wallet_address = {wallet:String}
        )
        AND transaction_hash != ''
        AND length(transaction_hash) = 66
      LIMIT 100
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const txList: any[] = await sampleTxs.json();
  const sampleTxHashes = txList.map(t => t.transaction_hash);
  console.log(`   Got ${sampleTxHashes.length} sample tx_hashes\n`);

  // Now trace them through other tables
  console.log('2️⃣ Checking vw_trades_canonical for these tx_hashes:');
  const vwCheck = await client.query({
    query: `
      SELECT
        count() as found_in_vw,
        countIf(condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as has_valid_condition_id,
        countIf(market_id_norm != '' AND market_id_norm != '0x' AND market_id_norm != '0x12' AND length(market_id_norm) >= 20) as has_valid_market_id,
        sum(usd_value) as total_volume
      FROM vw_trades_canonical
      WHERE transaction_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash 
            FROM trades_with_direction 
            WHERE wallet_address = {wallet:String}
          )
      )
      AND wallet_address_norm = {wallet:String}
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const vwData: any = (await vwCheck.json())[0];
  console.log(`   Found in vw_trades_canonical: ${parseInt(vwData.found_in_vw).toLocaleString()} rows`);
  console.log(`   Has valid condition_id: ${parseInt(vwData.has_valid_condition_id).toLocaleString()} (${(vwData.has_valid_condition_id * 100 / vwData.found_in_vw).toFixed(1)}%)`);
  console.log(`   Has valid market_id: ${parseInt(vwData.has_valid_market_id).toLocaleString()} (${(vwData.has_valid_market_id * 100 / vwData.found_in_vw).toFixed(1)}%)`);
  console.log(`   Volume: $${parseFloat(vwData.total_volume).toLocaleString()}\n`);

  console.log('3️⃣ Checking trade_direction_assignments:');
  const tdaCheck = await client.query({
    query: `
      SELECT
        count() as found_in_tda,
        countIf(condition_id_norm != '' AND length(condition_id_norm) >= 64) as has_condition_id,
        countIf(direction != 'UNKNOWN') as has_direction,
        countIf(confidence = 'HIGH') as high_confidence
      FROM trade_direction_assignments
      WHERE tx_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash 
            FROM trades_with_direction 
            WHERE wallet_address = {wallet:String}
          )
      )
      AND wallet_address = {wallet:String}
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const tdaData: any = (await tdaCheck.json())[0];
  console.log(`   Found in trade_direction_assignments: ${parseInt(tdaData.found_in_tda).toLocaleString()} rows`);
  console.log(`   Has condition_id: ${parseInt(tdaData.has_condition_id).toLocaleString()} (${(tdaData.has_condition_id * 100 / tdaData.found_in_tda).toFixed(1)}%)`);
  console.log(`   Has direction: ${parseInt(tdaData.has_direction).toLocaleString()} (${(tdaData.has_direction * 100 / tdaData.found_in_tda).toFixed(1)}%)`);
  console.log(`   High confidence: ${parseInt(tdaData.high_confidence).toLocaleString()} (${(tdaData.high_confidence * 100 / tdaData.found_in_tda).toFixed(1)}%)\n`);

  console.log('4️⃣ Sample: Do these tx_hashes have GOOD data in vw_trades_canonical?');
  const vwSample = await client.query({
    query: `
      SELECT
        transaction_hash,
        condition_id_norm,
        market_id_norm,
        usd_value,
        trade_direction
      FROM vw_trades_canonical
      WHERE transaction_hash IN (${sampleTxHashes.slice(0, 10).map(tx => `'${tx}'`).join(',')})
        AND wallet_address_norm = {wallet:String}
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log(await vwSample.json());

  console.log('\n5️⃣ CRITICAL: Are these REAL blockchain transactions?');
  console.log('   Checking Polygon blockchain via alchemy...\n');
  
  // Check first 5 tx_hashes on blockchain
  for (let i = 0; i < Math.min(5, sampleTxHashes.length); i++) {
    const tx = sampleTxHashes[i];
    console.log(`   Checking ${tx}...`);
    
    // This would need actual RPC call, but we can check erc1155_transfers
    const onChainCheck = await client.query({
      query: `
        SELECT count() as found
        FROM erc1155_transfers
        WHERE tx_hash = {tx:String}
      `,
      query_params: { tx },
      format: 'JSONEachRow',
    });
    const found = (await onChainCheck.json())[0];
    if (parseInt(found.found) > 0) {
      console.log(`   ✅ FOUND on blockchain (in erc1155_transfers)`);
    } else {
      console.log(`   ❌ NOT in erc1155_transfers (might not be fetched yet)`);
    }
  }

  console.log('\n6️⃣ SMOKING GUN: Overall stats for "missing" transactions:');
  const overall = await client.query({
    query: `
      WITH missing_txs AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash 
            FROM trades_with_direction 
            WHERE wallet_address = {wallet:String}
          )
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
      )
      SELECT
        (SELECT count() FROM missing_txs) as total_missing_txs,
        
        (SELECT count(DISTINCT v.transaction_hash)
         FROM vw_trades_canonical v
         INNER JOIN missing_txs m ON v.transaction_hash = m.transaction_hash
         WHERE v.wallet_address_norm = {wallet:String}
           AND v.condition_id_norm != ''
           AND v.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) as found_with_valid_data_in_vw,
        
        (SELECT count(DISTINCT t.tx_hash)
         FROM trade_direction_assignments t
         INNER JOIN missing_txs m ON t.tx_hash = m.transaction_hash
         WHERE t.wallet_address = {wallet:String}
           AND t.condition_id_norm != ''
        ) as found_with_valid_data_in_tda,
        
        found_with_valid_data_in_vw * 100.0 / total_missing_txs as recovery_rate_vw,
        found_with_valid_data_in_tda * 100.0 / total_missing_txs as recovery_rate_tda
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const overallData: any = (await overall.json())[0];
  console.log(`   Total missing tx_hashes: ${parseInt(overallData.total_missing_txs).toLocaleString()}`);
  console.log(`   \n   🎯 Found with VALID data in vw_trades_canonical: ${parseInt(overallData.found_with_valid_data_in_vw).toLocaleString()} (${parseFloat(overallData.recovery_rate_vw).toFixed(1)}%)`);
  console.log(`   🎯 Found with VALID data in trade_direction_assignments: ${parseInt(overallData.found_with_valid_data_in_tda).toLocaleString()} (${parseFloat(overallData.recovery_rate_tda).toFixed(1)}%)\n`);

  await client.close();
}

traceMissingTxs().catch(console.error);
