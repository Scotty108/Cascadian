import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function check() {
  const res = await clickhouse.query({
    query: 'DESCRIBE pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  const schema = await res.json();
  console.log(JSON.stringify(schema, null, 2));
}

check();
