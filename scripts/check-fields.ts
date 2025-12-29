#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function checkFields() {
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_id,
        slug,
        question,
        description,
        enriched_category,
        enriched_tags
      FROM pm_market_metadata FINAL
      WHERE slug LIKE 'nba-%'
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const data = await result.json<any>();

  console.log('\nChecking which fields have data:\n');
  data.forEach((row: any, i: number) => {
    console.log(`${i+1}.`);
    console.log(`   condition_id: "${row.condition_id}"`);
    console.log(`   market_id: "${row.market_id}"`);
    console.log(`   slug: "${row.slug}"`);
    console.log(`   question: "${row.question}"`);
    console.log(`   description length: ${row.description?.length || 0}`);
    console.log(`   enriched_category: "${row.enriched_category}"`);
    console.log(`   enriched_tags: [${row.enriched_tags.join(', ')}]`);
    console.log('');
  });
}

checkFields().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
