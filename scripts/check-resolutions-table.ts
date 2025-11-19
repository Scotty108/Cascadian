#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('Checking market_resolutions_final table quality...\n');

  // Sample some resolutions
  const sampleQuery = `
    SELECT *
    FROM market_resolutions_final
    WHERE length(payout_numerators) > 0
    LIMIT 5
  `;

  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json();

  console.log('Sample resolutions WITH payout data:');
  console.log(JSON.stringify(samples, null, 2));

  // Check how many have empty payouts
  const qualityQuery = `
    SELECT
      COUNT(*) as total_resolutions,
      SUM(CASE WHEN length(payout_numerators) > 0 THEN 1 ELSE 0 END) as with_payout,
      SUM(CASE WHEN length(payout_numerators) = 0 THEN 1 ELSE 0 END) as without_payout,
      round(SUM(CASE WHEN length(payout_numerators) > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as payout_coverage_pct
    FROM market_resolutions_final
  `;

  const qualityResult = await client.query({ query: qualityQuery, format: 'JSONEachRow' });
  const quality = await qualityResult.json();

  console.log('\n\nPayout data quality:');
  console.log(JSON.stringify(quality[0], null, 2));

  await client.close();
}

main().catch(console.error);
