import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function checkTables() {
  const query = `
    SELECT database, name, engine
    FROM system.tables
    WHERE name ILIKE '%resolution%'
    ORDER BY database, name
  `;
  
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('Resolution tables:', JSON.stringify(data, null, 2));
  
  await client.close();
}

checkTables().catch(console.error);
