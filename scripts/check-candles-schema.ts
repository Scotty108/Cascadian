import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const result = await client.query({
    query: 'DESCRIBE market_candles_5m',
    format: 'JSONEachRow',
  });
  
  const schema = await result.json();
  console.table(schema);
}

main().catch(console.error).finally(() => client.close());
