import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || ''
});

async function checkDatabases() {
  console.log('=== CHECKING CLICKHOUSE DATABASES ===\n');

  // List all databases
  const dbQuery = `SHOW DATABASES`;
  const dbResult = await client.query({ query: dbQuery, format: 'JSONEachRow' });
  const databases = await dbResult.json();
  console.log('Available databases:');
  console.log(databases);

  // For each database, list tables
  for (const db of databases) {
    const dbName = db.name;
    console.log(`\n\nTables in database "${dbName}":`);
    
    try {
      const tablesQuery = `SHOW TABLES FROM ${dbName}`;
      const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
      const tables = await tablesResult.json();
      console.log(tables);
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  await client.close();
}

checkDatabases().catch(console.error);
