import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: npx tsx scripts/sample-table.ts "<SQL>"');
    process.exit(1);
  }
  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  console.table(await res.json());
}

main().catch(console.error);
