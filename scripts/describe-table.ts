import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const table = process.argv[2];
  if (!table) {
    console.error('Usage: npx tsx scripts/describe-table.ts <table>');
    process.exit(1);
  }
  const res = await clickhouse.query({
    query: `DESCRIBE TABLE ${table}`,
    format: 'JSONEachRow'
  });
  console.table(await res.json());
}

main().catch(console.error);
