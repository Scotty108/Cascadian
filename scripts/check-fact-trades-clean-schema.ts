#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  const schema = await ch.query({
    query: 'DESCRIBE default.fact_trades_clean',
    format: 'JSONEachRow',
  });

  const cols = await schema.json();
  console.log('\nfact_trades_clean columns:\n');
  cols.forEach((c: any) => console.log(`  ${c.name.padEnd(25)} ${c.type}`));

  await ch.close();
})();
