import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkSchema() {
  console.log('\n📋 Checking gamma_markets schema\n');
  
  // Get schema
  const schemaQuery = 'DESCRIBE TABLE gamma_markets';
  const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await schemaResult.json();
  
  console.log('Columns:');
  console.table(schema);
  
  // Get sample data
  console.log('\n📊 Sample data:\n');
  const sampleQuery = 'SELECT * FROM gamma_markets LIMIT 1 FORMAT JSONEachRow';
  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json();
  
  if (samples.length > 0) {
    console.log('Sample row keys:', Object.keys(samples[0]));
    console.log('\nSample data (first row):');
    console.log(JSON.stringify(samples[0], null, 2));
  }
}

checkSchema().catch(console.error);
