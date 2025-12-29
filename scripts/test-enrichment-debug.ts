#!/usr/bin/env tsx
/**
 * Debug enrichment function - show which keywords match
 */

import { enrichMarketTags } from './enrich-market-tags-v2';

console.log('\n🔍 DEBUG: Which keywords are matching?\n');
console.log('='.repeat(80));

// Test: "Magic" market
console.log('\n✨ Test: Magic (Orlando NBA team)');
const result = enrichMarketTags(
  'Will Orlando Magic be 2023-24 NBA Champions?',
  [],
  'nba-will-orlando-magic-be-champions'
);
console.log(`   Question: "Will Orlando Magic be 2023-24 NBA Champions?"`);
console.log(`   Matched Keywords: [${result.matchedKeywords.join(', ')}]`);
console.log(`   Result Tags: [${result.enrichedTags.join(', ')}]`);
console.log(`   Has AI? ${result.enrichedTags.includes('AI')}`);
console.log(`   Has AGI? ${result.enrichedTags.includes('AGI')}`);

// Test: "Rockets" market
console.log('\n' + '='.repeat(80));
console.log('\n🚀 Test: Rockets (Houston NBA team)');
const result2 = enrichMarketTags(
  'Warriors vs. Rockets',
  [],
  'nba-warriors-vs-rockets'
);
console.log(`   Question: "Warriors vs. Rockets"`);
console.log(`   Matched Keywords: [${result2.matchedKeywords.join(', ')}]`);
console.log(`   Result Tags: [${result2.enrichedTags.join(', ')}]`);
console.log(`   Has SpaceX? ${result2.enrichedTags.includes('SpaceX')}`);

// Test: "T.J. McConnell"
console.log('\n' + '='.repeat(80));
console.log('\n🏀 Test: T.J. McConnell');
const result3 = enrichMarketTags(
  'Will T.J. McConnell score the first basket in Game 1 of the NBA Finals?',
  [],
  'will-tj-mcconnell-score-first-basket'
);
console.log(`   Question: "Will T.J. McConnell score the first basket in Game 1 of the NBA Finals?"`);
console.log(`   Matched Keywords: [${result3.matchedKeywords.join(', ')}]`);
console.log(`   Result Tags: [${result3.enrichedTags.join(', ')}]`);
console.log(`   Has Mitch McConnell? ${result3.enrichedTags.includes('Mitch McConnell')}`);

console.log('\n' + '='.repeat(80) + '\n');
