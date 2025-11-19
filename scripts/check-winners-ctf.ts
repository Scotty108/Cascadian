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
  // Check if winners_ctf exists
  const tables = await clickhouse.query({
    query: "SHOW TABLES LIKE 'winners_ctf'",
    format: 'JSONEachRow',
  });
  const tableList = await tables.json();
  console.log('Tables matching winners_ctf:', tableList);
  
  if (tableList.length > 0) {
    const count = await clickhouse.query({
      query: 'SELECT count() as cnt FROM winners_ctf',
      format: 'JSONEachRow',
    });
    const countData = await count.json<{ cnt: string }>();
    console.log(`winners_ctf has ${countData[0].cnt} rows`);
    
    const sample = await clickhouse.query({
      query: 'SELECT * FROM winners_ctf LIMIT 3',
      format: 'JSONEachRow',
    });
    const sampleData = await sample.json();
    console.log('Sample:', JSON.stringify(sampleData, null, 2));
  }
  
  await clickhouse.close();
}

main();
