#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function checkSchema() {
  const tables = ['pm_trades_canonical_v3', 'wallet_identity_map', 'vw_trades_canonical_with_canonical_wallet'];

  for (const table of tables) {
    console.log(`\n📋 Schema for ${table}:`);
    console.log('='.repeat(80));
    try {
      const result = await client.query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow',
      });
      const schema = await result.json();
      schema.forEach((col: any) => console.log(`  ${col.name.padEnd(30)} ${col.type}`));
    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`);
    }
  }

  await client.close();
}

checkSchema().catch(console.error);
