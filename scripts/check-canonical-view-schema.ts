#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const query = 'DESCRIBE pm_trades_canonical_v3';
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('Schema of pm_trades_canonical_v3:');
  console.log();
  rows.forEach((r: any) => {
    console.log(`  ${r.name.padEnd(30)} ${r.type}`);
  });
}

main().catch(console.error);
