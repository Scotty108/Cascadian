#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const result = await ch.query({
    query: 'DESCRIBE TABLE default.trade_cashflows_v3',
    format: 'JSONEachRow'
  });
  const schema = await result.json<any[]>();

  console.log('\ntrade_cashflows_v3 Schema:\n');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log('');

  await ch.close();
}

main().catch(console.error);
