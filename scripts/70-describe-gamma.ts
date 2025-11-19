import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function describeGamma() {
  // Get a sample row
  const query = `SELECT * FROM gamma_markets LIMIT 1`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  if (data.length > 0) {
    console.log('gamma_markets columns:');
    console.log(JSON.stringify(data[0], null, 2));
  }
}

describeGamma()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
