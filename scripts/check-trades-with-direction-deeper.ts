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
  console.log('\n🔍 Deep dive into trades_with_direction condition_id format:');
  
  const sample = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        tx_hash
      FROM trades_with_direction
      WHERE condition_id_norm != ''
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log('Sample condition_ids:', await sample.json());

  console.log('\n📊 Condition ID length distribution:');
  const lengths = await client.query({
    query: `
      SELECT
        length(condition_id_norm) as len,
        count() as count
      FROM trades_with_direction
      WHERE condition_id_norm != ''
      GROUP BY len
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await lengths.json());

  console.log('\n🎯 Quality metrics:');
  const quality = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(condition_id_norm != '') as has_any_condition_id,
        countIf(length(condition_id_norm) = 64) as has_64_char,
        countIf(length(condition_id_norm) = 66) as has_66_char,
        countIf(market_id != '') as has_market_id,
        countIf(direction_from_transfers != '') as has_direction
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  console.log(await quality.json());

  await client.close();
}

check().catch(console.error);
