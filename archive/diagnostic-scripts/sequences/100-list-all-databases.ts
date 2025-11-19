import 'dotenv/config';
import { clickhouse } from './lib/clickhouse/client';

async function listAllDatabases() {
  console.log('=== LISTING ALL DATABASES ===\n');
  
  const result = await clickhouse.query({
    query: `
      SELECT 
        name,
        engine,
        data_path,
        metadata_path
      FROM system.databases
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  
  const databases = await result.json();
  
  console.log('Total Databases:', databases.length);
  console.log('\nDatabases:');
  databases.forEach((db: any) => {
    console.log(`- ${db.name} (${db.engine})`);
  });
  
  return databases;
}

listAllDatabases().catch(console.error);
