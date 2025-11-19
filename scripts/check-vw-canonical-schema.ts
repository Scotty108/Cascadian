import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function checkSchema() {
  const result = await client.query({
    query: `DESCRIBE TABLE vw_trades_canonical`,
    format: 'JSONEachRow'
  });
  
  const schema = await result.json();
  console.log(JSON.stringify(schema, null, 2));
  await client.close();
}

checkSchema().catch(console.error);
