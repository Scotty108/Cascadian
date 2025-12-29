#!/usr/bin/env tsx
/**
 * Test the enrichment function directly
 * Verify it removes problematic tags
 */

import { enrichMarketTags } from './enrich-market-tags-v2';

console.log('\n🧪 TESTING ENRICHMENT FUNCTION DIRECTLY\n');
console.log('='.repeat(80));

// Test 1: "To Advance" should NOT match "vance"
console.log('\n🏀 Test 1: NBA "To Advance" market');
const test1 = enrichMarketTags(
  'NBA Playoffs: Pacers vs. Knicks (To Advance)',
  [],
  'nba-playoffs-pacers-vs-knicks-to-advance'
);
console.log(`   Question: "NBA Playoffs: Pacers vs. Knicks (To Advance)"`);
console.log(`   Slug: "nba-playoffs-pacers-vs-knicks-to-advance"`);
console.log(`   Result Category: ${test1.category}`);
console.log(`   Result Tags: [${test1.enrichedTags.join(', ')}]`);
console.log(`   Has JD Vance? ${test1.enrichedTags.includes('JD Vance') ? '❌ YES (BUG!)' : '✅ NO'}`);
console.log(`   Category is Sports? ${test1.category === 'Sports' ? '✅ YES' : `❌ NO (${test1.category})`}`);

// Test 2: "T.J. McConnell" should NOT match "mcconnell"
console.log('\n' + '='.repeat(80));
console.log('\n🏀 Test 2: T.J. McConnell market');
const test2 = enrichMarketTags(
  'Will T.J. McConnell score the first basket in Game 1 of the NBA Finals?',
  [],
  'will-tj-mcconnell-score-first-basket'
);
console.log(`   Question: "Will T.J. McConnell score the first basket in Game 1 of the NBA Finals?"`);
console.log(`   Result Tags: [${test2.enrichedTags.join(', ')}]`);
console.log(`   Has Mitch McConnell? ${test2.enrichedTags.includes('Mitch McConnell') ? '❌ YES (BUG!)' : '✅ NO'}`);

// Test 3: "Rockets" in NBA context should NOT get SpaceX tags
console.log('\n' + '='.repeat(80));
console.log('\n🚀 Test 3: Rockets (NBA team)');
const test3 = enrichMarketTags(
  'Warriors vs. Rockets',
  [],
  'nba-warriors-vs-rockets'
);
console.log(`   Question: "Warriors vs. Rockets"`);
console.log(`   Slug: "nba-warriors-vs-rockets"`);
console.log(`   Result Tags: [${test3.enrichedTags.join(', ')}]`);
console.log(`   Has SpaceX? ${test3.enrichedTags.includes('SpaceX') ? '❌ YES (BUG!)' : '✅ NO'}`);
console.log(`   Has Rocket launches? ${test3.enrichedTags.includes('Rocket launches') ? '❌ YES (BUG!)' : '✅ NO'}`);

// Test 4: "Magic" in NBA context should NOT get AI tags
console.log('\n' + '='.repeat(80));
console.log('\n✨ Test 4: Magic (NBA team)');
const test4 = enrichMarketTags(
  'Will Orlando Magic be 2023-24 NBA Champions?',
  [],
  'nba-will-orlando-magic-be-champions'
);
console.log(`   Question: "Will Orlando Magic be 2023-24 NBA Champions?"`);
console.log(`   Result Tags: [${test4.enrichedTags.join(', ')}]`);
console.log(`   Has AI? ${test4.enrichedTags.includes('AI') ? '❌ YES (BUG!)' : '✅ NO'}`);
console.log(`   Has AGI? ${test4.enrichedTags.includes('AGI') ? '❌ YES (BUG!)' : '✅ NO'}`);

// Test 5: NHL Senators should be Sports, not Politics
console.log('\n' + '='.repeat(80));
console.log('\n🏒 Test 5: NHL Senators');
const test5 = enrichMarketTags(
  'Senators vs. Capitals',
  [],
  'nhl-senators-vs-capitals'
);
console.log(`   Question: "Senators vs. Capitals"`);
console.log(`   Slug: "nhl-senators-vs-capitals"`);
console.log(`   Result Category: ${test5.category}`);
console.log(`   Result Tags: [${test5.enrichedTags.join(', ')}]`);
console.log(`   Category is Sports? ${test5.category === 'Sports' ? '✅ YES' : `❌ NO (${test5.category})`}`);

console.log('\n' + '='.repeat(80));
console.log('✅ Test complete!\n');
