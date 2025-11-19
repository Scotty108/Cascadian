#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== EXECUTING CID NORMALIZATION REPAIR ===\n');
  
  console.log('Strategy: Create empty table first, then populate via INSERT INTO SELECT\n');
  
  // Step 1: Create empty table structure
  console.log('Step 1: Creating table structure...\n');
  
  const createStructureSQL = `
    CREATE TABLE IF NOT EXISTS default.trades_with_direction_repaired (
      tx_hash String,
      wallet_address String,
      condition_id_norm String,
      market_id String,
      outcome_index UInt8,
      side_token String,
      direction_from_transfers Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3),
      shares Decimal(18, 8),
      price Decimal(18, 8),
      usd_value Decimal(18, 2),
      usdc_delta Decimal(18, 2),
      token_delta Decimal(18, 8),
      confidence Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3),
      reason String,
      recovery_status String,
      data_source String,
      computed_at DateTime
    )
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, wallet_address, outcome_index)
  `;
  
  try {
    await clickhouse.command({ query: createStructureSQL });
    console.log('✓ Table structure created\n');
  } catch (e: any) {
    if (e.message.includes('already exists')) {
      console.log('✓ Table already exists\n');
    } else {
      throw e;
    }
  }
  
  // Step 2: Populate via INSERT INTO SELECT (single batch)
  console.log('Step 2: Populating with normalized data...');
  console.log('(This will take 3-7 minutes for 82M rows)\n');
  
  const populateSQL = `
    INSERT INTO default.trades_with_direction_repaired
    SELECT
      twd.tx_hash,
      twd.wallet_address,
      lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
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
      now() as computed_at
    FROM default.trades_with_direction twd
    INNER JOIN default.trades_raw tr
      ON twd.tx_hash = tr.tx_hash
    WHERE length(replaceAll(tr.condition_id, '0x', '')) = 64
    SETTINGS max_execution_time = 600, max_memory_usage = 50000000000
  `;
  
  try {
    console.log('Executing INSERT...');
    await clickhouse.command({
      query: populateSQL,
      clickhouse_settings: {
        max_execution_time: 600,
        max_memory_usage: 50000000000,
        send_progress_in_http_headers: 0
      }
    });
    console.log('\n✓ Data inserted successfully\n');
    
    // Verify
    console.log('Step 3: Verifying repair...\n');
    
    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          countIf(length(condition_id_norm) = 64) as valid,
          countIf(condition_id_norm LIKE '0x%') as has_prefix,
          count() as total
        FROM default.trades_with_direction_repaired
      `,
      format: 'JSONEachRow'
    });
    const verifyData = await verifyResult.json<Array<any>>();
    
    console.log(`Verification:`);
    console.log(`  Valid (64-char):  ${verifyData[0].valid.toLocaleString()}`);
    console.log(`  Has 0x prefix:    ${verifyData[0].has_prefix.toLocaleString()}`);
    console.log(`  Total rows:       ${verifyData[0].total.toLocaleString()}\n`);
    
    if (verifyData[0].has_prefix === 0 && verifyData[0].valid === verifyData[0].total) {
      console.log('✅ SUCCESS: All condition IDs properly normalized!\n');
    }
    
  } catch (e: any) {
    console.error('\n❌ Error during INSERT:');
    console.error(e.message);
    console.error('\nThis may be due to client limitations with large queries.');
    console.error('Alternative: Execute via ClickHouse CLI or web UI\n');
  }
}

main().catch(console.error);
