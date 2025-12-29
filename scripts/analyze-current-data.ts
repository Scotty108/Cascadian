#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function analyzeData() {
  console.log('\n📊 ANALYZING CURRENT CATEGORIZATION ISSUES\n');
  console.log('='.repeat(80));

  // Sample 1: NBA markets with wrong category
  console.log('\n🏀 Sample 1: NBA markets categorized as Politics\n');
  const nbaPolitics = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE has(tags, 'NBA') AND category = 'Politics'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const nbaData = await nbaPolitics.json<any>();
  nbaData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   Slug: ${row.slug}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Sample 2: Rockets markets
  console.log('='.repeat(80));
  console.log('\n🚀 Sample 2: Rockets (Houston) markets\n');
  const rockets = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE question LIKE '%Rockets%'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const rocketsData = await rockets.json<any>();
  rocketsData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Sample 3: Magic (Orlando) markets
  console.log('='.repeat(80));
  console.log('\n✨ Sample 3: Magic (Orlando) markets\n');
  const magic = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE question LIKE '%Magic%' AND question NOT LIKE '%magic%'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const magicData = await magic.json<any>();
  magicData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Sample 4: MLB markets
  console.log('='.repeat(80));
  console.log('\n⚾ Sample 4: MLB markets (should be Sports)\n');
  const mlb = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE has(tags, 'MLB') AND category != 'Sports'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const mlbData = await mlb.json<any>();
  mlbData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   Slug: ${row.slug}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Sample 5: Category distribution
  console.log('='.repeat(80));
  console.log('\n📈 Current Category Distribution\n');
  const catDist = await clickhouse.query({
    query: `
      SELECT category, COUNT(*) as count
      FROM pm_market_metadata
      GROUP BY category
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const catData = await catDist.json<{ category: string; count: string }>();
  catData.forEach((row) => {
    console.log(`   ${row.category}: ${row.count}`);
  });

  // Sample 6: Tag combinations causing wrong categories
  console.log('\n' + '='.repeat(80));
  console.log('\n🔍 Sample 6: Markets with BOTH Sports and Politics tags\n');
  const mixed = await clickhouse.query({
    query: `
      SELECT question, category, tags
      FROM pm_market_metadata
      WHERE has(tags, 'Sports') AND has(tags, 'Politics')
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const mixedData = await mixed.json<any>();
  mixedData.forEach((row: any, i: number) => {
    console.log(`${i+1}. ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  console.log('='.repeat(80));
}

analyzeData()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
