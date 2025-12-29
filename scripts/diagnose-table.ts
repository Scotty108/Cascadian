#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function diagnose() {
  console.log('\n🔍 DIAGNOSING TABLE STATE\n');

  // Check total count
  const countResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata FINAL',
    format: 'JSONEachRow'
  });
  const countData = await countResult.json<{ count: string }>();
  console.log(`Total markets: ${countData[0].count}`);

  // Check how many have enriched data
  const enrichedResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(enriched_category != '') as has_category,
        countIf(length(enriched_tags) > 0) as has_tags
      FROM pm_market_metadata FINAL
    `,
    format: 'JSONEachRow'
  });
  const enrichedData = await enrichedResult.json<any>();
  console.log(`\nEnriched data:`);
  console.log(`  Has enriched_category: ${enrichedData[0].has_category}`);
  console.log(`  Has enriched_tags: ${enrichedData[0].has_tags}`);

  // Sample 5 markets
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        question,
        category,
        tags,
        enriched_category,
        enriched_tags,
        enrichment_version
      FROM pm_market_metadata FINAL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleResult.json<any>();
  console.log(`\n📋 Sample markets:\n`);
  sampleData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   OLD category: "${row.category}"`);
    console.log(`   OLD tags: [${row.tags.join(', ')}]`);
    console.log(`   NEW category: "${row.enriched_category}"`);
    console.log(`   NEW tags: [${row.enriched_tags.join(', ')}]`);
    console.log(`   Version: ${row.enrichment_version}`);
    console.log('');
  });
}

diagnose().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
