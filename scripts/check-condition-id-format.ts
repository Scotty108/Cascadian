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
  console.log('\n🔍 Sample condition_ids from trades_dedup_mat_new:');
  const sample = await client.query({
    query: `
      SELECT
        condition_id,
        market_id,
        length(condition_id) as cond_len,
        length(market_id) as market_len
      FROM trades_dedup_mat_new
      WHERE condition_id != ''
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n🔍 Distinct condition_id lengths:');
  const lengths = await client.query({
    query: `
      SELECT
        length(condition_id) as len,
        count() as count
      FROM trades_dedup_mat_new
      WHERE condition_id != ''
      GROUP BY len
      ORDER BY count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  console.log(await lengths.json());

  await client.close();
}

check().catch(console.error);
