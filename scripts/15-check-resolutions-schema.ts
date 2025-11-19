import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkResolutionsSchema() {
  console.log('=== Checking market_resolutions_final schema ===\n');

  const schemaQuery = `DESCRIBE market_resolutions_final`;
  const result = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await result.json<any[]>();

  console.log('Schema:');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log('');

  // Get a sample row
  const sampleQuery = `SELECT * FROM market_resolutions_final LIMIT 1`;
  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sample = await sampleResult.json<any[]>();

  console.log('Sample row:');
  console.log(JSON.stringify(sample[0], null, 2));
}

checkResolutionsSchema().catch(console.error);
