import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  const q = `DESCRIBE pm_condition_resolutions`;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json();
  for (const row of rows as any[]) {
    console.log(`${row.name}: ${row.type}`);
  }
  
  // Also sample the data
  const sample = `SELECT payout_numerators FROM pm_condition_resolutions LIMIT 3`;
  const sr = await clickhouse.query({ query: sample, format: 'JSONEachRow' });
  const srows = await sr.json();
  console.log('\nSample payout_numerators:');
  for (const row of srows as any[]) {
    console.log(row.payout_numerators);
  }
}
check().catch(console.error);
