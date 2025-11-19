#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== EXECUTING TABLE SWAP (Sequential) ===\n');
  
  console.log('Step 1: Rename old table to backup...\n');
  
  try {
    await clickhouse.command({
      query: 'RENAME TABLE default.trades_with_direction TO default.trades_with_direction_backup'
    });
    console.log('✓ Renamed trades_with_direction → trades_with_direction_backup\n');
  } catch (e: any) {
    console.error('Error renaming to backup:', e.message);
    throw e;
  }
  
  console.log('Step 2: Rename repaired table to production...\n');
  
  try {
    await clickhouse.command({
      query: 'RENAME TABLE default.trades_with_direction_repaired TO default.trades_with_direction'
    });
    console.log('✓ Renamed trades_with_direction_repaired → trades_with_direction\n');
  } catch (e: any) {
    console.error('Error activating repaired table:', e.message);
    console.error('\n❌ CRITICAL: Original table is backed up but repaired table not activated!');
    console.error('Manual recovery needed.\n');
    throw e;
  }
  
  console.log('Step 3: Verifying final state...\n');
  
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
  const tables = await verifyResult.json<Array<any>>();
  
  console.log('Final state:');
  tables.forEach(t => {
    console.log(`  ${t.name}: ${(t.total_rows || 0).toLocaleString()} rows`);
  });
  console.log();
  
  // Verify quality
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
  
  console.log('Active table quality:');
  console.log(`  Valid (64-char):  ${quality[0].valid.toLocaleString()} (${((quality[0].valid/quality[0].total)*100).toFixed(2)}%)`);
  console.log(`  Has 0x prefix:    ${quality[0].has_prefix.toLocaleString()}`);
  console.log(`  Total rows:       ${quality[0].total.toLocaleString()}\n`);
  
  if (quality[0].has_prefix === 0 && quality[0].valid === quality[0].total) {
    console.log('✅ SUCCESS: Table swap complete!');
    console.log('   trades_with_direction now has 100% normalized condition IDs\n');
  }
}

main().catch(console.error);
