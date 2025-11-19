#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== CHECKING CID REPAIR STATUS ===\n');
  
  // Check if repaired table exists
  const tablesResult = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_with_direction', 'trades_with_direction_repaired')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<Array<any>>();
  
  console.log('Tables found:\n');
  tables.forEach(t => {
    console.log(`${t.name}:`);
    console.log(`  Engine: ${t.engine}`);
    console.log(`  Rows: ${(t.total_rows || 0).toLocaleString()}\n`);
  });
  
  const hasRepaired = tables.some(t => t.name === 'trades_with_direction_repaired');
  
  if (hasRepaired) {
    console.log('✅ Repaired table EXISTS\n');
    console.log('Verifying normalization quality...\n');
    
    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          countIf(length(condition_id_norm) = 64) as valid_64char,
          countIf(length(condition_id_norm) != 64) as invalid,
          countIf(condition_id_norm LIKE '0x%') as has_prefix,
          count() as total
        FROM default.trades_with_direction_repaired
      `,
      format: 'JSONEachRow'
    });
    const verifyData = await verifyResult.json<Array<any>>();
    
    console.log(`Repaired table validation:`);
    console.log(`  Valid (64-char):  ${verifyData[0].valid_64char.toLocaleString()} (${((verifyData[0].valid_64char/verifyData[0].total)*100).toFixed(2)}%)`);
    console.log(`  Invalid length:   ${verifyData[0].invalid.toLocaleString()}`);
    console.log(`  Has 0x prefix:    ${verifyData[0].has_prefix.toLocaleString()}`);
    console.log(`  Total rows:       ${verifyData[0].total.toLocaleString()}\n`);
    
    if (verifyData[0].has_prefix === 0 && verifyData[0].valid_64char === verifyData[0].total) {
      console.log('✅ SUCCESS: Repair is COMPLETE and CORRECT!');
      console.log('   All condition IDs properly normalized (64-char, no 0x prefix)\n');
      console.log('Next step: Swap tables to activate repair\n');
    } else {
      console.log('⚠️  Repair table has issues - may need rebuild\n');
    }
    
  } else {
    console.log('❌ Repaired table does NOT exist\n');
    console.log('Need to execute repair SQL\n');
  }
}

main().catch(console.error);
