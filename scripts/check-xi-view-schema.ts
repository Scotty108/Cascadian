#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('Checking vw_xcn_repaired_only schema...\n');

  const result = await clickhouse.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default' AND table = 'vw_xcn_repaired_only'
      ORDER BY position
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json() as any[];

  console.log('Available columns:');
  console.log('─'.repeat(80));
  for (const col of data) {
    console.log(`  ${col.name.padEnd(40)} ${col.type}`);
  }

  console.log(`\nTotal columns: ${data.length}`);
}

main().catch(console.error);
