#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function findEdgeCases() {
  console.log('\n🔍 EDGE CASE ANALYSIS\n');
  console.log('='.repeat(80));

  // Case 1: Slug contains "nba" but category is NOT Sports
  console.log('\n📊 Case 1: Slug contains "nba" but category != Sports\n');
  const nbaResult = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE slug LIKE '%nba%'
        AND category != 'Sports'
      LIMIT 30
    `,
    format: 'JSONEachRow',
  });
  const nbaData = await nbaResult.json<any>();

  nbaData.forEach((row: any, i: number) => {
    console.log(`${i+1}. Question: ${row.question}`);
    console.log(`   Slug: ${row.slug}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });
  console.log(`Total: ${nbaData.length} markets\n`);

  // Case 2: Question contains "Rockets" (Houston Rockets NBA team)
  console.log('='.repeat(80));
  console.log('\n📊 Case 2: Question contains "Rockets" (likely Houston Rockets)\n');
  const rocketsResult = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE question LIKE '%Rockets%'
      LIMIT 30
    `,
    format: 'JSONEachRow',
  });
  const rocketsData = await rocketsResult.json<any>();

  rocketsData.forEach((row: any, i: number) => {
    console.log(`${i+1}. Question: ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });
  console.log(`Total: ${rocketsData.length} markets\n`);

  // Case 3: Question contains "76ers" or "Grizzlies"
  console.log('='.repeat(80));
  console.log('\n📊 Case 3: Question contains "76ers" or "Grizzlies"\n');
  const teamsResult = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE question LIKE '%76ers%' OR question LIKE '%Grizzlies%'
      LIMIT 30
    `,
    format: 'JSONEachRow',
  });
  const teamsData = await teamsResult.json<any>();

  teamsData.forEach((row: any, i: number) => {
    console.log(`${i+1}. Question: ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });
  console.log(`Total: ${teamsData.length} markets\n`);

  // Case 4: Slug contains "mlb" but category != Sports
  console.log('='.repeat(80));
  console.log('\n📊 Case 4: Slug contains "mlb" but category != Sports\n');
  const mlbResult = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata
      WHERE slug LIKE '%mlb%'
        AND category != 'Sports'
      LIMIT 30
    `,
    format: 'JSONEachRow',
  });
  const mlbData = await mlbResult.json<any>();

  mlbData.forEach((row: any, i: number) => {
    console.log(`${i+1}. Question: ${row.question}`);
    console.log(`   Slug: ${row.slug}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });
  console.log(`Total: ${mlbData.length} markets\n`);

  console.log('='.repeat(80));
}

findEdgeCases()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
