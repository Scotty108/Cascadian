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
  console.log('Checking trades_raw schema...\n');

  const query = `DESCRIBE TABLE trades_raw`;
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data: any[] = await result.json();

  console.log('Schema:');
  console.table(data);

  // Also show first row
  console.log('\n\nSample row:');
  const sampleQuery = `SELECT * FROM trades_raw LIMIT 1`;
  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData: any[] = await sampleResult.json();
  console.log(sampleData[0]);

  await client.close();
}

checkSchema().catch(console.error);
