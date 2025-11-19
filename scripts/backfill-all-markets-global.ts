#!/usr/bin/env tsx
/**
 * Phase 2: Global Market Universe Backfill
 * Fetches ALL Polymarket markets (not per-wallet)
 *
 * This is the correct approach:
 * - Fetch complete market universe ONCE
 * - Store in staging tables
 * - ALL wallets can then query their trades against this universe
 *
 * Data Sources:
 * 1. Gamma API (/markets) - All markets with metadata
 * 2. CLOB API (/markets) - Additional market data
 *
 * Expected: 150K+ total markets (all-time)
 * Runtime: 30-60 minutes
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

// ============================================================================
// GAMMA API - Primary Market Source
// ============================================================================

interface GammaMarket {
  conditionId: string;  // API uses camelCase
  question: string;
  slug: string;  // API uses 'slug' not 'market_slug'
  description?: string;
  outcomes: string | string[];  // API returns JSON string
  outcomePrices?: string | string[];  // API returns JSON string
  active: boolean;
  closed: boolean;
  archived?: boolean;
  new?: boolean;
  featured?: boolean;
  submitted_by?: string;
  umaBond?: string;
  umaReward?: string;
  volume?: string;
  liquidity?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  icon?: string;
  category?: string;
  enableOrderBook?: boolean;
}

async function fetchAllMarketsFromGamma(): Promise<GammaMarket[]> {
  console.log('\n📊 Fetching COMPLETE market history from Gamma API...');
  console.log('   Strategy: Fetch ALL markets without filters (gets everything)');
  console.log('   Pagination: 500 per page until exhausted\n');

  const allMarkets: GammaMarket[] = [];
  let offset = 0;
  const limit = 500; // Max allowed by Gamma API
  let pageNum = 1;

  // Fetch ALL markets (no filters = complete history)
  while (true) {
    try {
      // No status filters = get EVERYTHING (active, closed, archived, resolved)
      const url = `https://gamma-api.polymarket.com/markets?limit=${limit}&offset=${offset}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`❌ Gamma API error: ${response.status}`);
        break;
      }

      const markets: GammaMarket[] = await response.json();

      if (markets.length === 0) {
        console.log(`\n✅ Pagination complete at page ${pageNum - 1}`);
        break;
      }

      allMarkets.push(...markets);

      // Detailed progress
      const active = markets.filter(m => m.active).length;
      const closed = markets.filter(m => m.closed).length;
      const archived = markets.filter(m => m.archived).length;

      console.log(`  Page ${pageNum}: +${markets.length} markets | Total: ${allMarkets.length} | Active: ${active} | Closed: ${closed} | Archived: ${archived}`);

      if (markets.length < limit) {
        console.log(`\n✅ Last page reached (${markets.length} < ${limit})`);
        break;
      }

      offset += limit;
      pageNum++;
      await new Promise(r => setTimeout(r, 50)); // Faster rate limiting (50ms)

    } catch (error) {
      console.error(`❌ Error fetching markets at page ${pageNum}:`, error);
      break;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`✅ COMPLETE MARKET UNIVERSE FETCHED`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`Total markets: ${allMarkets.length}`);
  console.log(`  Active:   ${allMarkets.filter(m => m.active).length}`);
  console.log(`  Closed:   ${allMarkets.filter(m => m.closed).length}`);
  console.log(`  Archived: ${allMarkets.filter(m => m.archived).length}`);
  console.log(`  New:      ${allMarkets.filter(m => m.new).length}`);
  console.log(`  Featured: ${allMarkets.filter(m => m.featured).length}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // Verify we got a reasonable number
  if (allMarkets.length < 50000) {
    console.warn(`⚠️  WARNING: Only ${allMarkets.length} markets fetched`);
    console.warn(`   Expected: 100K-150K+ historical markets`);
    console.warn(`   This might indicate incomplete pagination`);
  }

  return allMarkets;
}

// ============================================================================
// CLICKHOUSE INSERTION
// ============================================================================

async function insertMarkets(markets: GammaMarket[]): Promise<void> {
  if (markets.length === 0) {
    console.log('  ⚠️  No markets to insert');
    return;
  }

  console.log(`\n💾 Inserting ${markets.length} markets into ClickHouse...`);

  const rows = markets
    .filter(m => m.conditionId) // Filter out invalid entries (use camelCase)
    .map(m => {
      // Parse outcomes if it's a JSON string
      let outcomes: string[] = [];
      if (typeof m.outcomes === 'string') {
        try {
          outcomes = JSON.parse(m.outcomes);
        } catch {
          outcomes = [];
        }
      } else {
        outcomes = m.outcomes || [];
      }

      return {
        condition_id: m.conditionId.toLowerCase().replace('0x', ''),
        market_slug: m.slug || '',
        question: m.question || '',
        description: m.description || '',
        outcomes: outcomes,
        active: m.active ?? false,
        closed: m.closed ?? false,
        resolved: false, // Will be updated later
        winning_outcome: null,
        end_date: m.endDate ? new Date(m.endDate) : null,
        volume: parseFloat(m.volume || '0'),
        liquidity: parseFloat(m.liquidity || '0'),
        timestamp: new Date(),
      };
    });

  // Insert in batches of 10K
  const batchSize = 10000;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await ch.insert({
      table: 'default.api_markets_staging',
      values: batch,
      format: 'JSONEachRow',
    });

    console.log(`  ✅ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} (${batch.length} markets)`);
  }

  console.log(`  ✅ Total inserted: ${rows.length} markets`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 GLOBAL MARKET UNIVERSE BACKFILL');
  console.log('   Fetching ALL Polymarket markets (not per-wallet)');
  console.log('═'.repeat(80));

  try {
    // Step 1: Fetch ALL markets from Gamma API
    const markets = await fetchAllMarketsFromGamma();

    if (markets.length === 0) {
      console.log('\n⚠️  No markets fetched');
      return;
    }

    // Step 2: Insert into ClickHouse
    await insertMarkets(markets);

    // Step 3: Verify insertion
    console.log('\n📊 Verifying insertion...');
    const result = await ch.query({
      query: `
        SELECT
          count() as total_markets,
          countIf(active = true) as active_markets,
          countIf(closed = true) as closed_markets,
          count(DISTINCT condition_id) as unique_conditions
        FROM default.api_markets_staging
      `,
      format: 'JSONEachRow',
    });

    const stats = await result.json();
    console.log('\nMarket Universe Statistics:');
    console.log(JSON.stringify(stats[0], null, 2));

    console.log('\n' + '═'.repeat(80));
    console.log('✅ GLOBAL MARKET BACKFILL COMPLETE');
    console.log('═'.repeat(80));
    console.log('\nNext steps:');
    console.log('  1. Run backfill-all-trades-global.ts to fetch ALL historical trades');
    console.log('  2. Run create-unified-trades-view.ts to combine with blockchain');
    console.log('  3. ANY wallet can now query their trades against this universe');

  } catch (error) {
    console.error('\n❌ Error during backfill:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
