import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkSchema() {
  console.log('Checking pm_trades_canonical_v3_sandbox schema...\n');

  const result = await clickhouse.query({
    query: 'DESCRIBE pm_trades_canonical_v3_sandbox',
    format: 'JSONEachRow'
  });

  const schema = await result.json();
  console.log(JSON.stringify(schema, null, 2));

  // Also get a sample row
  console.log('\n\nSample row:');
  const sample = await clickhouse.query({
    query: 'SELECT * FROM pm_trades_canonical_v3_sandbox LIMIT 1',
    format: 'JSONEachRow'
  });
  const sampleRow = await sample.json();
  console.log(JSON.stringify(sampleRow, null, 2));
}

checkSchema()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
