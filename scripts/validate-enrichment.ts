#!/usr/bin/env tsx
/**
 * Validation: Compare BEFORE and AFTER enrichment
 *
 * Checks if V3 enrichment fixed the categorization issues:
 * - NBA "To Advance" markets should be Sports (not Politics)
 * - T.J. McConnell should NOT match Mitch McConnell
 * - Rockets (Houston) should NOT get SpaceX tags
 * - Magic (Orlando) should NOT get AI tags
 * - NHL Senators should be Sports (not Politics)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function validateEnrichment() {
  console.log('\n✅ VALIDATION: V3 Enrichment Results\n');
  console.log('='.repeat(80));

  // Test 1: NBA "To Advance" markets (should be Sports, not Politics)
  console.log('\n🏀 Test 1: NBA Playoffs "To Advance" markets');
  const toAdvanceResult = await clickhouse.query({
    query: `
      SELECT
        question,
        slug,
        enriched_category as new_category,
        enriched_tags as new_tags,
        category as old_category,
        tags as old_tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%To Advance%'
        AND slug LIKE 'nba-%'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const toAdvanceData = await toAdvanceResult.json<any>();
  toAdvanceData.forEach((row: any, i: number) => {
    console.log(`\n   ${i + 1}. ${row.question}`);
    console.log(`      OLD: Category = ${row.old_category}, Tags = [${row.old_tags.join(', ')}]`);
    console.log(`      NEW: Category = ${row.new_category}, Tags = [${row.new_tags.join(', ')}]`);
    const hasVance = row.new_tags.includes('JD Vance');
    console.log(`      ✓ Fixed: ${hasVance ? '❌ STILL HAS JD VANCE TAG' : '✅ JD Vance tag removed'}`);
    console.log(`      ✓ Category: ${row.new_category === 'Sports' ? '✅ Sports' : `❌ ${row.new_category}`}`);
  });

  // Test 2: T.J. McConnell market (should NOT have Mitch McConnell tag)
  console.log('\n' + '='.repeat(80));
  console.log('\n🏀 Test 2: T.J. McConnell market');
  const tjResult = await clickhouse.query({
    query: `
      SELECT
        question,
        enriched_category as new_category,
        enriched_tags as new_tags,
        category as old_category,
        tags as old_tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%T.J. McConnell%'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const tjData = await tjResult.json<any>();
  tjData.forEach((row: any, i: number) => {
    console.log(`\n   ${i + 1}. ${row.question}`);
    console.log(`      OLD: Tags = [${row.old_tags.join(', ')}]`);
    console.log(`      NEW: Tags = [${row.new_tags.join(', ')}]`);
    const hasMitch = row.new_tags.includes('Mitch McConnell');
    console.log(`      ✓ Fixed: ${hasMitch ? '❌ STILL HAS MITCH MCCONNELL TAG' : '✅ Mitch McConnell tag removed'}`);
  });

  // Test 3: Rockets (Houston) markets (should NOT have SpaceX tags)
  console.log('\n' + '='.repeat(80));
  console.log('\n🚀 Test 3: Rockets (Houston NBA team) markets');
  const rocketsResult = await clickhouse.query({
    query: `
      SELECT
        question,
        enriched_category as new_category,
        enriched_tags as new_tags,
        tags as old_tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Rockets%'
        AND (question LIKE '%NBA%' OR slug LIKE 'nba-%')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const rocketsData = await rocketsResult.json<any>();
  rocketsData.forEach((row: any, i: number) => {
    console.log(`\n   ${i + 1}. ${row.question}`);
    console.log(`      OLD: Tags = [${row.old_tags.join(', ')}]`);
    console.log(`      NEW: Tags = [${row.new_tags.join(', ')}]`);
    const hasSpaceX = row.new_tags.includes('SpaceX');
    const hasRocketLaunches = row.new_tags.includes('Rocket launches');
    console.log(`      ✓ Fixed: ${hasSpaceX || hasRocketLaunches ? '❌ STILL HAS SPACEX TAGS' : '✅ SpaceX tags removed'}`);
  });

  // Test 4: Magic (Orlando) markets (should NOT have AI tags)
  console.log('\n' + '='.repeat(80));
  console.log('\n✨ Test 4: Magic (Orlando NBA team) markets');
  const magicResult = await clickhouse.query({
    query: `
      SELECT
        question,
        enriched_category as new_category,
        enriched_tags as new_tags,
        tags as old_tags
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Magic%'
        AND (question LIKE '%NBA%' OR question LIKE '%Orlando%')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const magicData = await magicResult.json<any>();
  magicData.forEach((row: any, i: number) => {
    console.log(`\n   ${i + 1}. ${row.question}`);
    console.log(`      OLD: Tags = [${row.old_tags.join(', ')}]`);
    console.log(`      NEW: Tags = [${row.new_tags.join(', ')}]`);
    const hasAI = row.new_tags.includes('AI') || row.new_tags.includes('AGI');
    console.log(`      ✓ Fixed: ${hasAI ? '❌ STILL HAS AI TAGS' : '✅ AI tags removed'}`);
  });

  // Test 5: NHL Senators markets (should be Sports, not Politics)
  console.log('\n' + '='.repeat(80));
  console.log('\n🏒 Test 5: NHL Senators markets');
  const senatorsResult = await clickhouse.query({
    query: `
      SELECT
        question,
        slug,
        enriched_category as new_category,
        enriched_tags as new_tags,
        category as old_category
      FROM pm_market_metadata FINAL
      WHERE question LIKE '%Senators%'
        AND slug LIKE 'nhl-%'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const senatorsData = await senatorsResult.json<any>();
  senatorsData.forEach((row: any, i: number) => {
    console.log(`\n   ${i + 1}. ${row.question}`);
    console.log(`      OLD Category: ${row.old_category}`);
    console.log(`      NEW Category: ${row.new_category}`);
    console.log(`      ✓ Fixed: ${row.new_category === 'Sports' ? '✅ Sports' : `❌ ${row.new_category}`}`);
  });

  // Test 6: Category distribution comparison
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Category Distribution: OLD vs NEW\n');

  const oldDistResult = await clickhouse.query({
    query: `
      SELECT category, COUNT(*) as count
      FROM pm_market_metadata FINAL
      GROUP BY category
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const oldDist = await oldDistResult.json<{ category: string; count: string }>();

  const newDistResult = await clickhouse.query({
    query: `
      SELECT enriched_category as category, COUNT(*) as count
      FROM pm_market_metadata FINAL
      GROUP BY enriched_category
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const newDist = await newDistResult.json<{ category: string; count: string }>();

  // Create comparison table
  const categories = ['Crypto', 'Other', 'Sports', 'Politics', 'Tech', 'Finance', 'World', 'Culture', 'Economy'];
  console.log('   Category       | OLD Count   | NEW Count   | Change');
  console.log('   ' + '-'.repeat(70));

  for (const category of categories) {
    const oldCount = parseInt(oldDist.find(d => d.category === category)?.count || '0');
    const newCount = parseInt(newDist.find(d => d.category === category)?.count || '0');
    const change = newCount - oldCount;
    const changeStr = change > 0 ? `+${change}` : `${change}`;
    const changeColor = Math.abs(change) > 100 ? '🔥' : '';
    console.log(`   ${category.padEnd(14)} | ${oldCount.toLocaleString().padStart(10)} | ${newCount.toLocaleString().padStart(10)} | ${changeStr.padStart(8)} ${changeColor}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Validation complete!\n');
}

validateEnrichment()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
