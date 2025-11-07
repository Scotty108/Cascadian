import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function main() {
  const query = 'DESCRIBE TABLE trades_raw';
  const result = await client.query({ query, format: 'JSONEachRow' });
  const schema = await result.json();
  console.table(schema);
  await client.close();
}

main();
