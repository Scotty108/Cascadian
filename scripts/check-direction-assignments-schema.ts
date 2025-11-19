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

async function check() {
  console.log('\n📋 Schema for trade_direction_assignments:');
  const schema = await client.query({
    query: `DESCRIBE TABLE trade_direction_assignments`,
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  cols.forEach((c: any) => console.log(`  ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n📊 Quick stats:');
  const stats = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT tx_hash) as unique_tx_hashes
      FROM trade_direction_assignments
    `,
    format: 'JSONEachRow',
  });
  console.log(await stats.json());

  console.log('\n📋 Schema for trade_cashflows_v3:');
  const cashflowSchema = await client.query({
    query: `DESCRIBE TABLE trade_cashflows_v3`,
    format: 'JSONEachRow',
  });
  const cashCols = await cashflowSchema.json();
  cashCols.forEach((c: any) => console.log(`  ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n📊 trade_cashflows_v3 stats:');
  const cashStats = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT wallet_address) as unique_wallets
      FROM trade_cashflows_v3
    `,
    format: 'JSONEachRow',
  });
  console.log(await cashStats.json());

  await client.close();
}

check().catch(console.error);
