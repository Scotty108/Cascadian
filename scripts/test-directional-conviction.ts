/**
 * Test Script: Directional Conviction Calculator
 *
 * This script tests the directional conviction calculator with real data.
 * Run with: npx tsx scripts/test-directional-conviction.ts
 */

import {
  calculateDirectionalConviction,
  calculateBothSides,
  type ConvictionResult,
} from '../lib/metrics/directional-conviction';
import { supabaseAdmin } from '../lib/supabase';

/**
 * Print conviction result in a nice format
 */
function printConvictionResult(result: ConvictionResult, label: string = '') {
  console.log('\n' + '='.repeat(60));
  if (label) console.log(label);
  console.log('='.repeat(60));
  console.log(`Market ID: ${result.marketId}`);
  console.log(`Condition ID: ${result.conditionId}`);
  console.log(`Side: ${result.side}`);
  console.log(`Timestamp: ${result.timestamp.toISOString()}`);
  console.log('\nConviction Scores:');
  console.log(`  Overall Conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
  console.log(`  Elite Consensus: ${(result.eliteConsensusPct * 100).toFixed(1)}%`);
  console.log(`  Category Specialist: ${(result.categorySpecialistPct * 100).toFixed(1)}%`);
  console.log(`  Omega-Weighted: ${(result.omegaWeightedConsensus * 100).toFixed(1)}%`);
  console.log(`\nMeets Entry Threshold (>= 90%): ${result.meetsEntryThreshold ? '✓ YES' : '✗ NO'}`);
  console.log('\nSupporting Data:');
  console.log(`  Elite Wallets: ${result.eliteWalletsOnSide} / ${result.eliteWalletsCount} on ${result.side}`);
  console.log(`  Specialists: ${result.specialistsOnSide} / ${result.specialistsCount} on ${result.side}`);
  console.log(`  Total Omega Weight: ${result.totalOmegaWeight.toFixed(2)}`);
  console.log('='.repeat(60));
}

/**
 * Get a test market from Supabase
 */
async function getTestMarket(): Promise<{
  market_id: string;
  condition_id: string;
  title: string;
  category: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('markets')
    .select('market_id, condition_id, title, category')
    .not('condition_id', 'is', null)
    .not('category', 'is', null)
    .limit(1)
    .single();

  if (error || !data) {
    console.error('Error fetching test market:', error);
    return null;
  }

  return data;
}

/**
 * Test 1: Basic conviction calculation
 */
async function test1_basicCalculation() {
  console.log('\n\n');
  console.log('TEST 1: Basic Conviction Calculation');
  console.log('=====================================\n');

  const market = await getTestMarket();
  if (!market) {
    console.log('No test market found. Skipping test.');
    return;
  }

  console.log(`Testing market: ${market.title}`);
  console.log(`Category: ${market.category}`);
  console.log(`Market ID: ${market.market_id}`);
  console.log(`Condition ID: ${market.condition_id}`);

  try {
    const result = await calculateDirectionalConviction({
      marketId: market.market_id,
      conditionId: market.condition_id,
      side: 'YES',
      lookbackHours: 24,
    });

    printConvictionResult(result, 'YES Side Conviction');
  } catch (error) {
    console.error('Error calculating conviction:', error);
  }
}

/**
 * Test 2: Compare both sides
 */
async function test2_compareBothSides() {
  console.log('\n\n');
  console.log('TEST 2: Compare YES vs NO Conviction');
  console.log('=====================================\n');

  const market = await getTestMarket();
  if (!market) {
    console.log('No test market found. Skipping test.');
    return;
  }

  console.log(`Testing market: ${market.title}`);

  try {
    const both = await calculateBothSides(
      market.market_id,
      market.condition_id,
      24
    );

    printConvictionResult(both.YES, 'YES Side');
    printConvictionResult(both.NO, 'NO Side');

    // Compare
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON');
    console.log('='.repeat(60));

    if (both.YES.directionalConviction > both.NO.directionalConviction) {
      const diff = both.YES.directionalConviction - both.NO.directionalConviction;
      console.log(`\n✓ Smart money favors YES`);
      console.log(`  Conviction difference: ${(diff * 100).toFixed(1)}%`);
    } else if (both.NO.directionalConviction > both.YES.directionalConviction) {
      const diff = both.NO.directionalConviction - both.YES.directionalConviction;
      console.log(`\n✓ Smart money favors NO`);
      console.log(`  Conviction difference: ${(diff * 100).toFixed(1)}%`);
    } else {
      console.log('\n≈ Smart money is evenly split');
    }

    console.log('='.repeat(60));
  } catch (error) {
    console.error('Error comparing both sides:', error);
  }
}

/**
 * Test 3: Multiple lookback periods
 */
async function test3_multipleLookbackPeriods() {
  console.log('\n\n');
  console.log('TEST 3: Different Lookback Periods');
  console.log('===================================\n');

  const market = await getTestMarket();
  if (!market) {
    console.log('No test market found. Skipping test.');
    return;
  }

  console.log(`Testing market: ${market.title}\n`);

  const lookbackPeriods = [6, 12, 24, 48, 72, 168]; // hours

  console.log('Lookback Period | Conviction | Elite | Specialist | Omega-Wtd | Elite Wallets');
  console.log('-'.repeat(90));

  for (const hours of lookbackPeriods) {
    try {
      const result = await calculateDirectionalConviction({
        marketId: market.market_id,
        conditionId: market.condition_id,
        side: 'YES',
        lookbackHours: hours,
      });

      const label = hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
      console.log(
        `${label.padEnd(16)}| ${(result.directionalConviction * 100).toFixed(1).padStart(6)}% | ` +
        `${(result.eliteConsensusPct * 100).toFixed(1).padStart(5)}% | ` +
        `${(result.categorySpecialistPct * 100).toFixed(1).padStart(10)}% | ` +
        `${(result.omegaWeightedConsensus * 100).toFixed(1).padStart(9)}% | ` +
        `${result.eliteWalletsOnSide}/${result.eliteWalletsCount}`
      );
    } catch (error) {
      console.log(`${hours}h: Error - ${error}`);
    }
  }
}

/**
 * Test 4: Test with known high-activity market
 */
async function test4_highActivityMarket() {
  console.log('\n\n');
  console.log('TEST 4: High Activity Market');
  console.log('=============================\n');

  // Get a market with high volume
  const { data: markets, error } = await supabaseAdmin
    .from('markets')
    .select('market_id, condition_id, title, category, volume')
    .not('condition_id', 'is', null)
    .not('category', 'is', null)
    .order('volume', { ascending: false })
    .limit(3);

  if (error || !markets || markets.length === 0) {
    console.log('No high-activity markets found. Skipping test.');
    return;
  }

  console.log(`Found ${markets.length} high-volume markets:\n`);

  for (const market of markets) {
    console.log(`\nMarket: ${market.title}`);
    console.log(`Volume: $${market.volume?.toLocaleString() ?? 'N/A'}`);

    try {
      const result = await calculateDirectionalConviction({
        marketId: market.market_id,
        conditionId: market.condition_id,
        side: 'YES',
        lookbackHours: 24,
      });

      console.log(`  Conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
      console.log(`  Elite wallets: ${result.eliteWalletsCount}`);
      console.log(`  Meets threshold: ${result.meetsEntryThreshold ? '✓' : '✗'}`);
    } catch (error) {
      console.log(`  Error: ${error}`);
    }
  }
}

/**
 * Test 5: Category specialist detection
 */
async function test5_categorySpecialists() {
  console.log('\n\n');
  console.log('TEST 5: Category Specialist Detection');
  console.log('======================================\n');

  // Get categories with specialists
  const { data: categories, error } = await supabaseAdmin
    .from('wallet_category_tags')
    .select('category')
    .eq('is_likely_specialist', true)
    .limit(5);

  if (error || !categories || categories.length === 0) {
    console.log('No category specialists found. Skipping test.');
    console.log('Run category tagging first: npm run calculate-category-omega');
    return;
  }

  const uniqueCategories = [...new Set(categories.map(c => c.category))];
  console.log(`Found specialists in ${uniqueCategories.length} categories:\n`);

  for (const category of uniqueCategories.slice(0, 3)) {
    // Get a market in this category
    const { data: market } = await supabaseAdmin
      .from('markets')
      .select('market_id, condition_id, title')
      .eq('category', category)
      .not('condition_id', 'is', null)
      .limit(1)
      .single();

    if (!market) continue;

    console.log(`\nCategory: ${category}`);
    console.log(`Market: ${market.title}`);

    try {
      const result = await calculateDirectionalConviction({
        marketId: market.market_id,
        conditionId: market.condition_id,
        side: 'YES',
        lookbackHours: 24,
      });

      console.log(`  Specialists on YES: ${result.specialistsOnSide} / ${result.specialistsCount}`);
      console.log(`  Specialist consensus: ${(result.categorySpecialistPct * 100).toFixed(1)}%`);
    } catch (error) {
      console.log(`  Error: ${error}`);
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n');
  console.log('*'.repeat(60));
  console.log('DIRECTIONAL CONVICTION CALCULATOR - TEST SUITE');
  console.log('*'.repeat(60));

  try {
    await test1_basicCalculation();
    await test2_compareBothSides();
    await test3_multipleLookbackPeriods();
    await test4_highActivityMarket();
    await test5_categorySpecialists();

    console.log('\n\n');
    console.log('*'.repeat(60));
    console.log('ALL TESTS COMPLETED');
    console.log('*'.repeat(60));
    console.log('\n');
  } catch (error) {
    console.error('\nTest suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests()
  .then(() => {
    console.log('Tests finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
