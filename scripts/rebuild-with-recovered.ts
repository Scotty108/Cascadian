#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function rebuild() {
  try {
    console.log('🔄 Rebuilding erc1155_transfers with recovered timestamps\n');
    
    // Step 1: Create fixed table
    console.log('Step 1: Creating fixed table...');
    await clickhouse.query({
      query: `
        CREATE TABLE erc1155_transfers_fixed ENGINE = ReplacingMergeTree()
        ORDER BY (block_number, log_index) AS
        SELECT
          f.block_number,
          f.log_index,
          f.tx_hash,
          f.address as contract,
          f.token_id,
          f.from_address,
          f.to_address,
          COALESCE(t.block_timestamp, toDateTime(0)) as block_timestamp,
          f.operator
        FROM pm_erc1155_flats f
        LEFT JOIN tmp_block_timestamps t ON f.block_number = t.block_number
      `,
    });
    console.log('  ✅ Created erc1155_transfers_fixed\n');
    
    // Step 2: Atomic swap
    console.log('Step 2: Atomic swap...');
    await clickhouse.query({
      query: `RENAME TABLE erc1155_transfers TO erc1155_transfers_old`,
    });
    await clickhouse.query({
      query: `RENAME TABLE erc1155_transfers_fixed TO erc1155_transfers`,
    });
    console.log('  ✅ Swapped tables\n');
    
    // Step 3: Cleanup
    console.log('Step 3: Cleaning up...');
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS erc1155_transfers_old`,
    });
    console.log('  ✅ Removed old table\n');
    
    // Verify
    console.log('📊 Verification:\n');
    const verifyResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp > toDateTime(0)) as with_ts,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const result = await verifyResult.json<any>();
    if (result && result[0]) {
      const r = result[0];
      const pct = (parseInt(r.with_ts) / parseInt(r.total) * 100).toFixed(2);
      console.log(`  Total rows: ${r.total}`);
      console.log(`  With real timestamps: ${r.with_ts}`);
      console.log(`  Epoch zero: ${r.epoch_zero}`);
      console.log(`  Coverage: ${pct}%`);
      console.log(`  Block range: ${r.min_block} → ${r.max_block}`);
    }
    
    console.log('\n✅ Rebuild complete!');
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

rebuild();
