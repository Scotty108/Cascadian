#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== CHECKING REPAIR PROGRESS ===\n');
  
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM default.trades_with_direction_repaired`,
    format: 'JSONEachRow'
  });
  const count = await countResult.json<Array<any>>();
  
  console.log(`Current rows in repaired table: ${parseInt(count[0].cnt).toLocaleString()}\n`);
  
  if (parseInt(count[0].cnt) === 0) {
    console.log('❌ Table is empty - INSERT did not complete');
    console.log('\nThe Node.js client cannot handle this large operation.');
    console.log('Need alternative approach.\n');
  } else if (parseInt(count[0].cnt) < 80000000) {
    console.log('🔄 Table is populating - check again in a few minutes\n');
  } else {
    console.log('✅ Table appears populated - verifying quality...\n');
  }
}

main().catch(console.error);
