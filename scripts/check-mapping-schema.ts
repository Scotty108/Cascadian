#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const result = await ch.query({
    query: 'DESCRIBE cascadian_clean.system_wallet_map',
    format: 'JSONEachRow'
  });
  const rows = await result.json<Array<{name: string; type: string}>>();
  console.log('system_wallet_map columns:');
  for (const row of rows) {
    console.log(`  ${row.name}: ${row.type}`);
  }
  await ch.close();
}

main().catch(console.error);
