/**
 * Verify Full Sync - Test that we can fetch all Polymarket events
 *
 * This script tests the pagination fix in client.ts to ensure we fetch
 * all ~3,242 events instead of just 1,000.
 */

import { fetchEvents, fetchAllActiveMarkets } from '@/lib/polymarket/client';

async function main() {
  console.log('🔍 Testing full event fetch with pagination...\n');

  try {
    // Test 1: Fetch all events
    console.log('📊 Fetching all events...');
    const startEvents = Date.now();
    const events = await fetchEvents();
    const eventsTime = Date.now() - startEvents;

    console.log(`✅ Fetched ${events.length} events in ${(eventsTime / 1000).toFixed(1)}s`);

    if (events.length < 3000) {
      console.warn(`⚠️  Warning: Expected ~3,242 events, got ${events.length}`);
    } else {
      console.log(`✅ Event count looks good! (Expected ~3,242)`);
    }

    // Test 2: Expand to markets
    console.log('\n📊 Fetching and expanding to markets...');
    const startMarkets = Date.now();
    const markets = await fetchAllActiveMarkets();
    const marketsTime = Date.now() - startMarkets;

    console.log(`✅ Fetched ${markets.length} markets in ${(marketsTime / 1000).toFixed(1)}s`);

    if (markets.length < 10000) {
      console.warn(`⚠️  Warning: Expected ~13,502 markets, got ${markets.length}`);
    } else {
      console.log(`✅ Market count looks good! (Expected ~13,502)`);
    }

    // Test 3: Category breakdown
    const categoryCount = new Map<string, number>();
    markets.forEach(market => {
      const category = market.category || 'Uncategorized';
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    });

    console.log('\n📊 Markets by category:');
    Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count} markets`);
      });

    // Test 4: Check for daily/monthly markets
    const now = Date.now();
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    const marketsEndingSoon = markets.filter(m => {
      const endTime = m.end_date.getTime();
      return endTime < now + oneMonth;
    });

    console.log(`\n📊 Markets ending within 30 days: ${marketsEndingSoon.length}`);

    if (marketsEndingSoon.length > 0) {
      console.log('✅ Found daily/monthly markets!');
    }

    console.log('\n✅ Verification complete!');
    console.log(`\n📈 Summary:`);
    console.log(`  Events: ${events.length}`);
    console.log(`  Markets: ${markets.length}`);
    console.log(`  Categories: ${categoryCount.size}`);
    console.log(`  Ending soon: ${marketsEndingSoon.length}`);

  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

main();
