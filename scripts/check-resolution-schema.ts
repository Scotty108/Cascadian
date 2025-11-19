#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Check if market_resolutions_final exists and its schema
  const tables = await clickhouse.query({
    query: "SHOW TABLES LIKE '%resolution%'",
    format: 'JSONEachRow',
  });

  const tableList = await tables.json();
  console.log('Resolution tables:', tableList);

  // Describe market_resolutions_final if it exists
  try {
    const desc = await clickhouse.query({
      query: "DESCRIBE TABLE market_resolutions_final",
      format: 'JSONEachRow',
    });
    const schema = await desc.json();
    console.log('\nmarket_resolutions_final schema:');
    console.log(schema);

    // Sample data
    const sample = await clickhouse.query({
      query: "SELECT * FROM market_resolutions_final LIMIT 3",
      format: 'JSONEachRow',
    });
    const data = await sample.json();
    console.log('\nSample data:');
    console.log(JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  await clickhouse.close();
}

main();
