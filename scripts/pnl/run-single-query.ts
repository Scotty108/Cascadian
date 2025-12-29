import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: npx tsx run-single-query.ts "<SQL>"');
  process.exit(1);
}

clickhouse.query({ query: sql, format: 'JSONEachRow' })
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error('Error:', err.message));
