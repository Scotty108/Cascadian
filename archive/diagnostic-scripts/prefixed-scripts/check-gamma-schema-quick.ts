import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkSchema() {
  const result = await clickhouse.query({
    query: 'DESCRIBE gamma_markets',
    format: 'JSONEachRow'
  });
  const schema = await result.json();
  console.log(JSON.stringify(schema, null, 2));
}

checkSchema().catch(console.error);
