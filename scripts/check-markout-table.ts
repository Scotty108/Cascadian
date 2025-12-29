import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  // Check if markout_14d_fills exists
  const tables = await clickhouse.query({
    query: "SHOW TABLES LIKE '%markout%'",
    format: 'JSONEachRow'
  });
  console.log('Markout tables:', await tables.json());

  // Check its schema
  try {
    const schema = await clickhouse.query({
      query: 'DESCRIBE markout_14d_fills',
      format: 'JSONEachRow'
    });
    console.log('\nmarkout_14d_fills schema:');
    const rows = await schema.json() as any[];
    rows.forEach((r: any) => console.log(`  ${r.name}: ${r.type}`));

    // Sample
    const sample = await clickhouse.query({
      query: 'SELECT * FROM markout_14d_fills LIMIT 3',
      format: 'JSONEachRow'
    });
    console.log('\nSample rows:');
    const sampleRows = await sample.json() as any[];
    sampleRows.forEach((r: any) => console.log(JSON.stringify(r)));

    // Date range
    const dateRange = await clickhouse.query({
      query: 'SELECT min(trade_date) as min_date, max(trade_date) as max_date, count() as total FROM markout_14d_fills',
      format: 'JSONEachRow'
    });
    console.log('\nDate range:', await dateRange.json());
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
