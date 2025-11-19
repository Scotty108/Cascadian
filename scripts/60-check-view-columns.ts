import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkViewColumns() {
  const query = `DESCRIBE vw_trades_canonical_with_canonical_wallet`;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('View columns:\n');
  const usdColumns = [];
  const sharesColumns = [];

  for (const row of data) {
    console.log(`  ${row.name}: ${row.type}`);
    if (row.name.includes('usd')) {
      usdColumns.push(row.name);
    }
    if (row.name.includes('shares')) {
      sharesColumns.push(row.name);
    }
  }

  console.log('\nUSD-related columns:', usdColumns.join(', '));
  console.log('Shares-related columns:', sharesColumns.join(', '));
}

checkViewColumns()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
