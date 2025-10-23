/**
 * Test Script: Trade Data Aggregation
 *
 * Tests the trade aggregator on a single high-volume market
 *
 * Usage:
 *   npx tsx scripts/test-trade-aggregation.ts
 */

import { aggregateMarketTrades } from '../lib/polymarket/trade-aggregator';
import { supabaseAdmin } from '../lib/supabase';

async function test() {
  console.log('='.repeat(80));
  console.log('Trade Aggregation Test');
  console.log('='.repeat(80));
  console.log('');

  // Test with a high-volume market
  // Using Irish Presidential Election as example
  const testMarketId = '529278';
  const testConditionId = '0xc0bb48cbe15ac8483d5111ac41360a02eb1a4ad516ba20dbf2862651079f78ec';

  console.log('Testing trade aggregation for market:');
  console.log(`  Market ID: ${testMarketId}`);
  console.log(`  Condition ID: ${testConditionId}`);
  console.log('');

  // First, verify the market exists in database
  console.log('Verifying market exists in database...');
  const { data: market, error: marketError } = await supabaseAdmin
    .from('markets')
    .select('market_id, title, condition_id, volume_24h')
    .eq('market_id', testMarketId)
    .single();

  if (marketError || !market) {
    console.error('❌ Market not found in database!');
    console.error('Error:', marketError);
    console.log('');
    console.log('Available markets:');

    // Show some available markets
    const { data: availableMarkets } = await supabaseAdmin
      .from('markets')
      .select('market_id, title, condition_id, volume_24h')
      .eq('active', true)
      .eq('closed', false)
      .not('condition_id', 'is', null)
      .order('volume_24h', { ascending: false })
      .limit(5);

    if (availableMarkets) {
      availableMarkets.forEach(m => {
        console.log(`  - ${m.market_id}: ${m.title}`);
        console.log(`    Condition: ${m.condition_id}`);
        console.log(`    Volume: $${m.volume_24h}`);
        console.log('');
      });

      console.log('Update the test script with one of these market IDs and condition IDs.');
    }

    process.exit(1);
  }

  console.log('✅ Market found:');
  console.log(`  Title: ${market.title}`);
  console.log(`  Volume 24h: $${market.volume_24h}`);
  console.log('');

  // Run aggregation
  console.log('Running trade aggregation...');
  console.log('This may take 30-60 seconds depending on trade volume...');
  console.log('');

  const startTime = Date.now();

  try {
    const analytics = await aggregateMarketTrades(testMarketId, testConditionId);
    const duration = Date.now() - startTime;

    console.log('✅ Aggregation completed in', duration, 'ms');
    console.log('');
    console.log('Results:');
    console.log('-'.repeat(80));
    console.log(JSON.stringify(analytics, null, 2));
    console.log('-'.repeat(80));
    console.log('');

    // Verify data was saved to database
    console.log('Verifying data was saved to database...');
    const { data: savedAnalytics, error: fetchError } = await supabaseAdmin
      .from('market_analytics')
      .select('*')
      .eq('market_id', testMarketId)
      .single();

    if (fetchError || !savedAnalytics) {
      console.error('❌ Failed to fetch saved analytics from database!');
      console.error('Error:', fetchError);
      process.exit(1);
    }

    console.log('✅ Data successfully saved to database');
    console.log('');

    // Summary
    console.log('='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    console.log('Market:', market.title);
    console.log('Duration:', duration, 'ms');
    console.log('');
    console.log('Metrics:');
    console.log(`  Trades (24h):        ${analytics.trades_24h.toLocaleString()}`);
    console.log(`  Unique Buyers:       ${analytics.buyers_24h.toLocaleString()}`);
    console.log(`  Unique Sellers:      ${analytics.sellers_24h.toLocaleString()}`);
    console.log(`  Buy/Sell Ratio:      ${analytics.buy_sell_ratio.toFixed(2)} ${analytics.buy_sell_ratio > 1 ? '(Bullish)' : '(Bearish)'}`);
    console.log(`  Buy Volume:          $${analytics.buy_volume_24h.toLocaleString()}`);
    console.log(`  Sell Volume:         $${analytics.sell_volume_24h.toLocaleString()}`);
    console.log(`  Momentum Score:      ${analytics.momentum_score.toFixed(4)}`);
    console.log(`  Price Change (24h):  ${analytics.price_change_24h > 0 ? '+' : ''}${analytics.price_change_24h.toFixed(2)}%`);
    console.log('');
    console.log('✅ Test passed!');

  } catch (error) {
    console.error('❌ Aggregation failed!');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run test
test().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
