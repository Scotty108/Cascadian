import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default'
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
      console.log('  (no tables found)');
    } else {
      console.log('Found ' + tables.length + ' tables:\n');
      tables.forEach((t: any, i: number) => {
        const tableName = t.name || Object.values(t)[0];
        console.log((i + 1) + '. ' + tableName);
      });
    }
    return tables.map((t: any) => t.name || Object.values(t)[0]);
  } catch (error: any) {
    console.log('ERROR: ' + error.message);
    return [];
  }
}

async function main() {
  console.log('Connecting to ClickHouse Cloud...');
  console.log('Host: ' + process.env.CLICKHOUSE_HOST);
  
  const defaultTables = await listTables('default');
  const cleanTables = await listTables('cascadian_clean');
  
  await client.close();
}

main().catch(console.error);
