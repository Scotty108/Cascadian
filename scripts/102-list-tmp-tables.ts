#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const rows = await clickhouse.query({
    query: "SELECT name FROM system.tables WHERE database = currentDatabase() AND name LIKE 'tmp_global%' ORDER BY name",
    format: 'JSONEachRow'
  }).then(r => r.json());
  console.log(rows);
}
main().catch(e=>{console.error(e);process.exit(1);});
