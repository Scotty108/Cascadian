import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('DISCOVERING RESOLUTION TABLE SCHEMAS');
  console.log('='.repeat(80));
  console.log();

  // First, list all tables in cascadian_clean
  console.log('Tables in cascadian_clean database:');
  const tablesQuery = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = 'cascadian_clean'
      AND name LIKE '%resolution%'
    ORDER BY name
  `;
  
  const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json();
  console.log(JSON.stringify(tables, null, 2));
  console.log();

  // Check each table's schema
  const tablesToCheck = [
    'cascadian_clean.resolutions_src_api',
    'cascadian_clean.resolutions_by_cid',
    'cascadian_clean.vw_resolutions_unified',
    'default.vw_trades_canonical'
  ];

  for (const table of tablesToCheck) {
    try {
      console.log('-'.repeat(80));
      console.log(`Schema for ${table}:`);
      
      const schemaQuery = `DESCRIBE ${table}`;
      const schemaResult = await client.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json();
      console.log(JSON.stringify(schema, null, 2));
      
      // Get sample data
      console.log(`\nSample data from ${table} (first 2 rows):`);
      const sampleQuery = `SELECT * FROM ${table} LIMIT 2`;
      const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
      const samples = await sampleResult.json();
      console.log(JSON.stringify(samples, null, 2));
      console.log();
      
    } catch (error: any) {
      console.log(`ERROR: ${error.message}\n`);
    }
  }

  await client.close();
}

main().catch(console.error);
