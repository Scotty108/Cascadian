#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  const result = await ch.query({
    query: 'DESCRIBE TABLE default.vw_trades_canonical',
    format: 'JSONEachRow',
  });
  const cols = await result.json<any[]>();
  console.log('vw_trades_canonical columns:');
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));
  await ch.close();
}

main().catch(console.error);
