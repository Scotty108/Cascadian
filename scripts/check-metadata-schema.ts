#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\nChecking market_metadata_wallet_enriched schema...\n');

  // Get schema
  const schemaQuery = `DESCRIBE TABLE default.market_metadata_wallet_enriched`;
  const result = await ch.query({ query: schemaQuery, format: 'JSONEachRow' });
  const columns = await result.json<any[]>();

  console.log('Columns:\n');
  columns.forEach(col => {
    console.log(`  ${col.name} (${col.type})`);
  });

  // Sample 3 rows
  const sampleQuery = `SELECT * FROM default.market_metadata_wallet_enriched LIMIT 3`;
  const sampleResult = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json<any[]>();

  console.log('\nSample rows:\n');
  sampleData.forEach((row, i) => {
    console.log(`Row ${i + 1}:`, JSON.stringify(row, null, 2));
  });

  await ch.close();
}

main().catch(console.error);
