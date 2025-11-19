import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || ''
});

async function listTables(database: string) {
  console.log('\n=== Tables in database: ' + database + ' ===\n');
  
  try {
    const result = await client.query({
      query: 'SHOW TABLES FROM ' + database,
      format: 'JSONEachRow'
    });
    const tables = await result.json<any>();
    
    if (tables.length === 0) {
      console.log('  (no tables found or database does not exist)');
    } else {
      tables.forEach((t: any, i: number) => {
        const tableName = t.name || Object.values(t)[0];
        console.log((i + 1) + '. ' + tableName);
      });
    }
  } catch (error: any) {
    console.log('ERROR: ' + error.message);
  }
}

async function main() {
  await listTables('default');
  await listTables('cascadian_clean');
  await client.close();
}

main().catch(console.error);
