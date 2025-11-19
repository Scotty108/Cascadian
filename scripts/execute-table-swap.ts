#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== EXECUTING TABLE SWAP ===\n');
  
  console.log('Step 1: Verify repaired table exists and is ready...\n');
  
  const checkResult = await clickhouse.query({
    query: `
      SELECT
        name,
        total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_with_direction', 'trades_with_direction_repaired')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tables = await checkResult.json<Array<any>>();
  
  console.log('Current state:');
  tables.forEach(t => {
    console.log(`  ${t.name}: ${(t.total_rows || 0).toLocaleString()} rows`);
  });
  console.log();
  
  const hasOriginal = tables.some(t => t.name === 'trades_with_direction');
  const hasRepaired = tables.some(t => t.name === 'trades_with_direction_repaired');
  
  if (!hasRepaired) {
    console.error('❌ ERROR: trades_with_direction_repaired does not exist!');
    console.error('Cannot proceed with swap.\n');
    process.exit(1);
  }
  
  console.log('Step 2: Executing atomic swap...\n');
  
  // Atomic rename - both tables swap in single transaction
  const swapSQL = `
    RENAME TABLE 
      default.trades_with_direction TO default.trades_with_direction_backup,
      default.trades_with_direction_repaired TO default.trades_with_direction
  `;
  
  try {
    await clickhouse.command({ query: swapSQL });
    console.log('✅ SUCCESS: Tables swapped!\n');
    
    // Verify new state
    console.log('Step 3: Verifying new state...\n');
    
    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          name,
          total_rows
        FROM system.tables
        WHERE database = 'default'
          AND name LIKE 'trades_with_direction%'
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const newTables = await verifyResult.json<Array<any>>();
    
    console.log('After swap:');
    newTables.forEach(t => {
      console.log(`  ${t.name}: ${(t.total_rows || 0).toLocaleString()} rows`);
    });
    console.log();
    
    // Check normalization quality of active table
    console.log('Step 4: Verifying active table quality...\n');
    
    const qualityResult = await clickhouse.query({
      query: `
        SELECT
          countIf(length(condition_id_norm) = 64) as valid,
          countIf(condition_id_norm LIKE '0x%') as has_prefix,
          count() as total
        FROM default.trades_with_direction
      `,
      format: 'JSONEachRow'
    });
    const quality = await qualityResult.json<Array<any>>();
    
    console.log('Active table (trades_with_direction):');
    console.log(`  Valid (64-char):  ${quality[0].valid.toLocaleString()} (${((quality[0].valid/quality[0].total)*100).toFixed(2)}%)`);
    console.log(`  Has 0x prefix:    ${quality[0].has_prefix.toLocaleString()}`);
    console.log(`  Total rows:       ${quality[0].total.toLocaleString()}\n`);
    
    if (quality[0].has_prefix === 0 && quality[0].valid === quality[0].total) {
      console.log('✅ PERFECT: Active table has 100% normalized condition IDs\n');
      console.log('Table swap complete and verified!');
      console.log('trades_with_direction now contains properly normalized data.\n');
    } else {
      console.warn('⚠️  Warning: Active table may have quality issues\n');
    }
    
  } catch (e: any) {
    console.error('❌ ERROR during swap:');
    console.error(e.message);
    console.error('\nSwap failed - tables remain in original state\n');
    process.exit(1);
  }
}

main().catch(console.error);
