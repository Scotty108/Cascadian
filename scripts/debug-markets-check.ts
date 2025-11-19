#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Checking pm_markets timestamps...');

  const query = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_markets,
        MIN(resolved_at) as min_resolved_at,
        MAX(resolved_at) as max_resolved_at
      FROM pm_markets
      WHERE market_type = 'binary'
    `,
    format: 'JSONEachRow'
  });

  const result = await query.json();
  console.log(JSON.stringify(result, null, 2));

  // Also check sample of resolved markets
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT condition_id, status, resolved_at
      FROM pm_markets
      WHERE status = 'resolved'
        AND market_type = 'binary'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('\nSample resolved markets:');
  console.log(JSON.stringify(samples, null, 2));
}

main();
