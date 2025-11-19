import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function checkMappings() {
  console.log('=== CHECKING TOKEN MAPPING TABLES ===\n');

  // Check all potential mapping tables
  const tables = [
    'default.erc1155_condition_map',
    'default.ctf_token_map',
    'cascadian_clean.token_condition_market_map'
  ];

  for (const table of tables) {
    console.log(`\n\nTable: ${table}`);
    console.log('='.repeat(60));

    try {
      // Get schema
      const schemaQuery = `
        SELECT name, type
        FROM system.columns
        WHERE database = '${table.split('.')[0]}'
          AND table = '${table.split('.')[1]}'
        ORDER BY position
      `;

      const schemaResult = await client.query({ query: schemaQuery, format: 'JSONEachRow' });
      const schema = await schemaResult.json();

      console.log('\nSchema:');
      schema.forEach((col: any) => console.log(`  ${col.name}: ${col.type}`));

      // Get sample rows
      const sampleQuery = `SELECT * FROM ${table} LIMIT 3`;
      const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
      const sample = await sampleResult.json();

      console.log('\nSample rows:');
      console.log(JSON.stringify(sample, null, 2));

      // Get row count
      const countQuery = `SELECT COUNT(*) as count FROM ${table}`;
      const countResult = await client.query({ query: countQuery, format: 'JSONEachRow' });
      const count = await countResult.json();
      console.log(`\nTotal rows: ${count[0].count}`);

    } catch (e: any) {
      console.log(`\nError: ${e.message}`);
    }
  }

  await client.close();
}

checkMappings().catch(console.error);
