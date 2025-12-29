#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  const result = await clickhouse.query({
    query: `
      SELECT
        question,
        slug,
        canonical_tags,
        canonical_category,
        enriched_tags,
        enriched_category
      FROM pm_market_metadata
      WHERE question LIKE '%To Advance%' AND slug LIKE 'nba-%'
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<any>();
  data.forEach((row: any, i: number) => {
    console.log(`\nMarket ${i+1}: ${row.question}`);
    console.log(`  Canonical Tags: [${row.canonical_tags.join(', ')}]`);
    console.log(`  Enriched Tags:  [${row.enriched_tags.join(', ')}]`);
    console.log(`  Are they the same? ${JSON.stringify(row.canonical_tags) === JSON.stringify(row.enriched_tags) ? 'YES - PROBLEM!' : 'NO'}`);
  });
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
