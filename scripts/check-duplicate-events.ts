/**
 * Check for duplicate event IDs in the database
 */

import { supabaseAdmin } from '@/lib/supabase';

async function main() {
  console.log('🔍 Checking for duplicate event IDs...\n');

  try {
    // Get all markets
    const { data: markets, error } = await supabaseAdmin
      .from('markets')
      .select('market_id, title, event_id, event_slug, raw_polymarket_data, category, active, closed, current_price, volume_total')
      .eq('active', true);

    if (error) {
      throw error;
    }

    if (!markets || markets.length === 0) {
      console.log('No markets found');
      return;
    }

    console.log(`📊 Total active markets: ${markets.length}\n`);

    // Filter out uninitiated markets
    const initiatedMarkets = markets.filter(m => {
      const isUninitiated = Math.abs(m.current_price - 0.5) < 0.01 && m.volume_total < 100;
      return !isUninitiated;
    });

    console.log(`📊 Initiated markets (after filtering): ${initiatedMarkets.length}\n`);

    // Group by event_id
    const eventMap = new Map<string, any[]>();
    const noEventId: any[] = [];

    initiatedMarkets.forEach(market => {
      const eventId = market.event_id || (market.raw_polymarket_data as any)?.event_id;

      if (!eventId) {
        noEventId.push(market);
      } else {
        if (!eventMap.has(eventId)) {
          eventMap.set(eventId, []);
        }
        eventMap.get(eventId)!.push(market);
      }
    });

    console.log(`📊 Unique events: ${eventMap.size}`);
    console.log(`📊 Markets without event_id: ${noEventId.length}\n`);

    // Check for the specific event_id mentioned in error
    if (eventMap.has('641764')) {
      const markets641764 = eventMap.get('641764')!;
      console.log(`🔍 Event ID 641764 details:`);
      console.log(`  Markets: ${markets641764.length}`);
      markets641764.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.title} (${m.market_id})`);
        console.log(`     Category: ${m.category}`);
        console.log(`     Event Slug: ${m.event_slug}`);
      });
      console.log('');
    }

    // Check for duplicate event IDs in the result
    // This happens when the fallback logic creates duplicates
    const eventIdCounts = new Map<string, number>();

    initiatedMarkets.forEach(market => {
      // Mimic the frontend logic
      const eventId = market.event_id || (market.raw_polymarket_data as any)?.event_id || market.market_id;
      eventIdCounts.set(eventId, (eventIdCounts.get(eventId) || 0) + 1);
    });

    // Find any that appear multiple times when using market_id fallback
    const potentialDuplicates = Array.from(eventIdCounts.entries())
      .filter(([id, count]) => {
        // Check if this ID appears as both event_id and market_id
        const asEventId = initiatedMarkets.some(m =>
          (m.event_id || (m.raw_polymarket_data as any)?.event_id) === id
        );
        const asMarketId = initiatedMarkets.some(m =>
          !m.event_id && !(m.raw_polymarket_data as any)?.event_id && m.market_id === id
        );
        return asEventId && asMarketId;
      });

    if (potentialDuplicates.length > 0) {
      console.log(`⚠️  Found ${potentialDuplicates.length} potential duplicate IDs:`);
      potentialDuplicates.forEach(([id]) => {
        console.log(`  - ${id}`);
      });
    } else {
      console.log('✅ No duplicate event/market ID collisions found');
    }

    // Show breakdown by category
    console.log('\n📊 Markets by category:');
    const categoryCount = new Map<string, number>();
    initiatedMarkets.forEach(m => {
      categoryCount.set(m.category, (categoryCount.get(m.category) || 0) + 1);
    });
    Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        const events = Array.from(eventMap.values()).filter(markets =>
          markets.some(m => m.category === cat)
        ).length;
        console.log(`  ${cat}: ${count} markets, ${events} events`);
      });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
