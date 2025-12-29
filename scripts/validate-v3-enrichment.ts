#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function validate() {
  console.log('\n🧪 VALIDATION: V3 Enrichment Tests\n');

  // Test 1: NBA "To Advance" should NOT have JD Vance tag
  const test1 = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%To Advance%' AND slug LIKE 'nba-%'
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const test1Data = await test1.json<any>();
  console.log('📋 Test 1: NBA "To Advance" markets:');
  test1Data.forEach((row: any, i: number) => {
    const hasVance = row.tags.some((t: string) => t.toLowerCase().includes('vance'));
    console.log(`  ${i+1}. ${row.question}`);
    console.log(`     Category: ${row.category}`);
    console.log(`     Has JD Vance tag? ${hasVance ? '❌ YES (BUG!)' : '✅ NO'}`);
    console.log(`     Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Test 2: T.J. McConnell should NOT have Mitch McConnell tag
  const test2 = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%T.J. McConnell%' OR question LIKE '%TJ McConnell%'
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const test2Data = await test2.json<any>();
  console.log('📋 Test 2: T.J. McConnell markets:');
  test2Data.forEach((row: any, i: number) => {
    const hasMitch = row.tags.some((t: string) =>
      t.toLowerCase() === 'mitch mcconnell' || t === 'Mitch McConnell'
    );
    console.log(`  ${i+1}. ${row.question}`);
    console.log(`     Category: ${row.category}`);
    console.log(`     Has Mitch McConnell tag? ${hasMitch ? '❌ YES (BUG!)' : '✅ NO'}`);
    console.log(`     Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Test 3: Rockets (NBA) should NOT have SpaceX tags
  const test3 = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Rockets%' AND (slug LIKE 'nba-%' OR question LIKE '%NBA%')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const test3Data = await test3.json<any>();
  console.log('📋 Test 3: NBA Rockets markets:');
  test3Data.forEach((row: any, i: number) => {
    const hasSpaceX = row.tags.some((t: string) =>
      t.toLowerCase().includes('spacex') || t.toLowerCase().includes('rocket launch')
    );
    console.log(`  ${i+1}. ${row.question}`);
    console.log(`     Category: ${row.category}`);
    console.log(`     Has SpaceX tags? ${hasSpaceX ? '❌ YES (BUG!)' : '✅ NO'}`);
    console.log(`     Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Test 4: Magic (NBA) should NOT have AI tags
  const test4 = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Magic%' AND (slug LIKE 'nba-%' OR question LIKE '%NBA%')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const test4Data = await test4.json<any>();
  console.log('📋 Test 4: NBA Magic markets:');
  test4Data.forEach((row: any, i: number) => {
    const hasAI = row.tags.some((t: string) => ['AI', 'AGI'].includes(t));
    console.log(`  ${i+1}. ${row.question}`);
    console.log(`     Category: ${row.category}`);
    console.log(`     Has AI/AGI tags? ${hasAI ? '❌ YES (BUG!)' : '✅ NO'}`);
    console.log(`     Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  // Test 5: NHL Senators should be Sports category
  const test5 = await clickhouse.query({
    query: `
      SELECT question, slug, category, tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Senators%' AND (slug LIKE 'nhl-%' OR question LIKE '%NHL%')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const test5Data = await test5.json<any>();
  console.log('📋 Test 5: NHL Senators markets:');
  test5Data.forEach((row: any, i: number) => {
    console.log(`  ${i+1}. ${row.question}`);
    console.log(`     Category: ${row.category} ${row.category === 'Sports' ? '✅' : '❌'}`);
    console.log(`     Tags: [${row.tags.join(', ')}]`);
    console.log('');
  });

  console.log('\n✅ Validation complete\n');
}

validate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
