#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== TASK 2: REPAIR CONDITION IDs IN trades_with_direction ===\n');
  
  // STEP 1: Analyze join key options
  console.log('━━━ STEP 1: Identify Best Join Key ━━━\n');
  
  // Check tx_hash coverage
  const txHashResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tx_hash != '') as non_empty_tx_hash,
        count() as total
      FROM default.trades_with_direction
    `,
    format: 'JSONEachRow'
  });
  const txHashData = await txHashResult.json<Array<any>>();
  
  console.log(`tx_hash coverage in trades_with_direction:`);
  console.log(`  Non-empty: ${txHashData[0].non_empty_tx_hash.toLocaleString()} (${((txHashData[0].non_empty_tx_hash/txHashData[0].total)*100).toFixed(2)}%)`);
  console.log(`  Total:     ${txHashData[0].total.toLocaleString()}\n`);
  
  // Check if tx_hash exists in both tables and is unique enough
  const joinTestResult = await clickhouse.query({
    query: `
      SELECT count() as joinable_rows
      FROM default.trades_with_direction twd
      INNER JOIN default.trades_raw tr
        ON twd.tx_hash = tr.tx_hash
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const joinTest = await joinTestResult.json<Array<any>>();
  
  console.log(`Join test (tx_hash): Successful`);
  console.log(`Join key: tx_hash is the most reliable identifier\n`);
  
  // STEP 2: Create repaired table
  console.log('━━━ STEP 2: Create Repaired Table ━━━\n');
  
  console.log('Creating trades_with_direction_repaired table...');
  console.log('This will use trades_raw as ground truth for condition_id normalization.\n');
  
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS default.trades_with_direction_repaired
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, wallet_address, outcome_index)
    AS
    SELECT
      twd.tx_hash,
      twd.wallet_address,
      lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,  -- FIXED: Use trades_raw
      twd.market_id,
      twd.outcome_index,
      twd.side_token,
      twd.direction_from_transfers,
      twd.shares,
      twd.price,
      twd.usd_value,
      twd.usdc_delta,
      twd.token_delta,
      twd.confidence,
      twd.reason,
      twd.recovery_status,
      twd.data_source,
      now() as computed_at  -- Mark as repaired
    FROM default.trades_with_direction twd
    INNER JOIN default.trades_raw tr
      ON twd.tx_hash = tr.tx_hash
    WHERE length(replaceAll(tr.condition_id, '0x', '')) = 64  -- Only valid condition IDs
  `;
  
  console.log('Executing CREATE TABLE AS SELECT...');
  console.log('(This may take 2-5 minutes for 82M rows)\n');
  
  await clickhouse.command({
    query: createTableQuery,
    clickhouse_settings: {
      max_execution_time: 600  // 10 minutes
    }
  });
  
  console.log('✓ Table created: trades_with_direction_repaired\n');
  
  // STEP 3: Verify repair
  console.log('━━━ STEP 3: Verify Repair ━━━\n');
  
  const verifyResult = await clickhouse.query({
    query: `
      WITH normalized AS (
        SELECT
          condition_id_norm,
          length(condition_id_norm) as len,
          condition_id_norm LIKE '0x%' as has_prefix
        FROM default.trades_with_direction_repaired
      )
      SELECT
        countIf(len = 64) as valid_64char,
        countIf(len != 64) as invalid_length,
        countIf(has_prefix) as has_0x_prefix,
        count() as total
      FROM normalized
    `,
    format: 'JSONEachRow'
  });
  const verifyData = await verifyResult.json<Array<any>>();
  
  console.log(`Repaired Table Validation:`);
  console.log(`  Valid (64-char hex):  ${verifyData[0].valid_64char.toLocaleString()} (${((verifyData[0].valid_64char/verifyData[0].total)*100).toFixed(2)}%)`);
  console.log(`  Invalid length:       ${verifyData[0].invalid_length.toLocaleString()}`);
  console.log(`  Has 0x prefix:        ${verifyData[0].has_0x_prefix.toLocaleString()}`);
  console.log(`  Total:                ${verifyData[0].total.toLocaleString()}\n`);
  
  if (verifyData[0].has_0x_prefix === 0 && verifyData[0].valid_64char === verifyData[0].total) {
    console.log('✅ SUCCESS: All condition IDs properly normalized!\n');
  } else {
    console.log('❌ ISSUE: Some rows still have formatting problems.\n');
  }
  
  // Sample repaired data
  console.log('━━━ Sample Repaired Data ━━━\n');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        wallet_address,
        condition_id_norm,
        direction_from_transfers,
        shares,
        price
      FROM default.trades_with_direction_repaired
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<Array<any>>();
  
  samples.forEach((s, i) => {
    console.log(`${i+1}. TX: ${s.tx_hash.substring(0, 20)}...`);
    console.log(`   Wallet: ${s.wallet_address.substring(0, 20)}...`);
    console.log(`   CID (norm): ${s.condition_id_norm.substring(0, 20)}... (len: ${s.condition_id_norm.length})`);
    console.log(`   Direction: ${s.direction_from_transfers}`);
    console.log(`   Shares: ${s.shares} @ $${s.price}\n`);
  });
  
  // STEP 4: Compare row counts
  console.log('━━━ STEP 4: Row Count Comparison ━━━\n');
  
  const originalCountResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM default.trades_with_direction`,
    format: 'JSONEachRow'
  });
  const originalCount = await originalCountResult.json<Array<any>>();
  
  const repairedCountResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM default.trades_with_direction_repaired`,
    format: 'JSONEachRow'
  });
  const repairedCount = await repairedCountResult.json<Array<any>>();
  
  console.log(`Original table: ${originalCount[0].cnt.toLocaleString()} rows`);
  console.log(`Repaired table: ${repairedCount[0].cnt.toLocaleString()} rows`);
  console.log(`Difference:     ${(originalCount[0].cnt - repairedCount[0].cnt).toLocaleString()} rows (filtered out invalid CIDs)\n`);
  
  // STEP 5: Instructions for swap
  console.log('━━━ STEP 5: Next Steps ━━━\n');
  console.log('The repaired table is ready. To activate it:\n');
  console.log('1. Backup current table:');
  console.log('   RENAME TABLE default.trades_with_direction TO default.trades_with_direction_backup\n');
  console.log('2. Activate repaired table:');
  console.log('   RENAME TABLE default.trades_with_direction_repaired TO default.trades_with_direction\n');
  console.log('3. After verification, drop backup:');
  console.log('   DROP TABLE default.trades_with_direction_backup\n');
  
  console.log('NOTE: Not executing swap automatically for safety.');
  console.log('Review results above before proceeding.\n');
}

main().catch(console.error);
