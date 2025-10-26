/**
 * Verify event grouping logic
 */

import { supabaseAdmin } from '@/lib/supabase';

async function main() {
  console.log('🔍 Verifying event grouping logic...\n');

  try {
    // Get all active markets with pagination (Supabase has 1000 row limit per query)
    const allMarkets: any[] = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    console.log('📊 Fetching all active markets with pagination...\n');

    while (hasMore) {
      const { data, error, count } = await supabaseAdmin
        .from('markets')
        .select('market_id, event_id, title, category, current_price, volume_total, raw_polymarket_data', { count: 'exact' })
        .eq('active', true)
        .range(offset, offset + limit - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allMarkets.push(...data);
        console.log(`  Fetched ${data.length} markets at offset ${offset} (total so far: ${allMarkets.length})`);

        hasMore = data.length === limit && allMarkets.length < (count || 0);
        offset += limit;
      } else {
        hasMore = false;
      }
    }

    const markets = allMarkets;
    console.log(`\n📊 Total fetched: ${markets.length} active markets\n`);

    // Filter uninitiated markets (same logic as frontend)
    const initiatedMarkets = markets.filter(m => {
      const isUninitiated = Math.abs(m.current_price - 0.5) < 0.01 && m.volume_total < 100;
      return !isUninitiated;
    });

    console.log(`📊 After filtering uninitiated: ${initiatedMarkets.length} markets\n`);

    // Group using the CORRECTED logic (with prefixes)
    const eventMapCorrected = new Map<string, any[]>();

    initiatedMarkets.forEach(market => {
      const rawEventId = market.event_id || (market.raw_polymarket_data as any)?.event_id;
      const eventId = rawEventId ? `event-${rawEventId}` : `market-${market.market_id}`;

      if (!eventMapCorrected.has(eventId)) {
        eventMapCorrected.set(eventId, []);
      }
      eventMapCorrected.get(eventId)!.push(market);
    });

    console.log(`✅ Unique events (with prefix fix): ${eventMapCorrected.size}`);

    // Group using the OLD logic (without prefixes)
    const eventMapOld = new Map<string, any[]>();

    initiatedMarkets.forEach(market => {
      const eventId = market.event_id || (market.raw_polymarket_data as any)?.event_id || market.market_id;

      if (!eventMapOld.has(eventId)) {
        eventMapOld.set(eventId, []);
      }
      eventMapOld.get(eventId)!.push(market);
    });

    console.log(`⚠️  Unique events (old logic): ${eventMapOld.size}\n`);

    // Check for collisions
    const duplicateIds = Array.from(eventMapOld.entries())
      .filter(([id, markets]) => {
        // Check if this ID is used as both event_id and market_id
        const hasAsEventId = initiatedMarkets.some(m =>
          (m.event_id || (m.raw_polymarket_data as any)?.event_id) === id
        );
        const hasAsMarketId = initiatedMarkets.some(m =>
          !(m.event_id || (m.raw_polymarket_data as any)?.event_id) && m.market_id === id
        );
        return hasAsEventId && hasAsMarketId;
      });

    if (duplicateIds.length > 0) {
      console.log(`❌ Found ${duplicateIds.length} ID collisions:\n`);
      duplicateIds.slice(0, 5).forEach(([id, markets]) => {
        console.log(`  ID: ${id}`);
        console.log(`    Used by ${markets.length} markets`);
      });
      if (duplicateIds.length > 5) {
        console.log(`  ... and ${duplicateIds.length - 5} more\n`);
      }
    } else {
      console.log('✅ No ID collisions found\n');
    }

    // Show breakdown
    const marketsPerEvent = Array.from(eventMapCorrected.values()).map(m => m.length);
    const avg = marketsPerEvent.reduce((a, b) => a + b, 0) / marketsPerEvent.length;
    const max = Math.max(...marketsPerEvent);
    const min = Math.min(...marketsPerEvent);

    console.log('📊 Markets per event statistics:');
    console.log(`  Average: ${avg.toFixed(1)}`);
    console.log(`  Min: ${min}`);
    console.log(`  Max: ${max}`);
    console.log(`  Single-market events: ${marketsPerEvent.filter(n => n === 1).length}`);
    console.log(`  Multi-market events: ${marketsPerEvent.filter(n => n > 1).length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
