import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  // Check for non-numeric asset_ids
  console.log('Checking for non-numeric asset_ids...');
  const badData = await clickhouse.query({
    query: `
      SELECT asset_id, count(*) as count
      FROM clob_fills
      WHERE NOT match(asset_id, '^[0-9]+$')
      GROUP BY asset_id
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const bad = await badData.json();
  console.log('Non-numeric asset_ids:', bad);
  console.log();

  // Get total count of valid asset_ids
  console.log('Getting count of VALID asset_ids...');
  const validCount = await clickhouse.query({
    query: `
      SELECT count(DISTINCT asset_id) as count
      FROM clob_fills
      WHERE match(asset_id, '^[0-9]+$')
    `,
    format: 'JSONEachRow'
  });
  const valid = await validCount.json();
  console.log('Valid distinct asset_ids:', valid[0].count);
}

main().catch(console.error);
