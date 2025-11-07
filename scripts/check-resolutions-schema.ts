#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function checkSchema() {
  console.log('Checking market_resolutions_final schema...\n');

  const query = `DESCRIBE TABLE market_resolutions_final`;
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data: any[] = await result.json();

  console.log('Schema:');
  console.table(data);

  console.log('\n\nSample rows:');
  const sampleQuery = `SELECT * FROM market_resolutions_final LIMIT 5`;
  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData: any[] = await sampleResult.json();
  sampleData.forEach((row, i) => {
    console.log(`\nRow ${i + 1}:`);
    console.log(row);
  });

  await client.close();
}

checkSchema().catch(console.error);
