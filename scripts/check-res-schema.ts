#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function main() {
  const query = `DESCRIBE TABLE market_resolutions_final`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('market_resolutions_final schema:');
  console.log(data);
  await clickhouse.close();
}

main();
