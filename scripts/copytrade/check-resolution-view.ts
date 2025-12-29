import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  // Check vw_pm_resolution_prices structure
  const q1 = `DESCRIBE vw_pm_resolution_prices`;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  console.log('vw_pm_resolution_prices columns:');
  console.log(await r1.json());

  // Sample data
  const q2 = `SELECT * FROM vw_pm_resolution_prices LIMIT 3`;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  console.log('\nSample data:');
  console.log(await r2.json());

  // Check pm_resolution_prices_corrected
  const q3 = `DESCRIBE pm_resolution_prices_corrected`;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  console.log('\npm_resolution_prices_corrected columns:');
  console.log(await r3.json());

  // Sample
  const q4 = `SELECT * FROM pm_resolution_prices_corrected LIMIT 3`;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  console.log('\nSample:');
  console.log(await r4.json());
}

main().catch(console.error);
