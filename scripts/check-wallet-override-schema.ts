#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  // Check schema
  console.log('Checking wallet_identity_overrides schema...\n');

  const describeQuery = 'DESCRIBE TABLE wallet_identity_overrides';
  const describeResult = await clickhouse.query({ query: describeQuery, format: 'JSONEachRow' });
  const schema = await describeResult.json() as any[];

  console.log('Table Schema:');
  console.log('─'.repeat(80));
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(30)} ${col.type.padEnd(30)} ${col.default_type || ''}`);
  }
  console.log('');

  // Check existing data
  console.log('Existing Mappings:');
  console.log('─'.repeat(80));

  const selectQuery = 'SELECT * FROM wallet_identity_overrides';
  const selectResult = await clickhouse.query({ query: selectQuery, format: 'JSONEachRow' });
  const mappings = await selectResult.json() as any[];

  if (mappings.length === 0) {
    console.log('  No mappings found');
  } else {
    for (const mapping of mappings) {
      console.log(`  Executor: ${mapping.executor_wallet}`);
      console.log(`  Account:  ${mapping.canonical_wallet}`);
      console.log(`  Type:     ${mapping.mapping_type}`);
      console.log('');
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
