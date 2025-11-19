import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const res = await clickhouse.query({
    query: "DESCRIBE TABLE clob_fills",
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  console.table(rows);
  
  const sample = await clickhouse.query({
    query: "SELECT * FROM clob_fills LIMIT 1",
    format: 'JSONEachRow'
  });
  const sampleRows = await sample.json();
  console.log("\nSample row:");
  console.log(sampleRows[0]);
}

main().catch(console.error);
