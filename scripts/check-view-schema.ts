import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function checkSchema() {
  const query = `DESCRIBE TABLE default.vw_trades_canonical`;
  
  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  console.log('vw_trades_canonical schema:');
  console.log(JSON.stringify(data, null, 2));
  
  await client.close();
}

checkSchema().catch(console.error);
