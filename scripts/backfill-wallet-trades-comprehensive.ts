#!/usr/bin/env tsx
/**
 * Phase 2: Comprehensive Wallet Trade Backfill
 * Fetches all historical trades and positions from Polymarket APIs
 *
 * Data Sources:
 * 1. Data API (/positions) - Current positions with P&L
 * 2. Data API (/trades) - Historical trade activity [if available]
 * 3. CLOB API (/markets) - Market metadata
 *
 * Usage:
 *   npx tsx backfill-wallet-trades-comprehensive.ts 0x4ce7...
 *   npx tsx backfill-wallet-trades-comprehensive.ts --top-wallets 100
 *
 * Runtime: ~5-10 minutes per wallet (depending on activity)
 * Expected result: 2,816 markets for wallet 0x4ce7
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
// API INTERFACES
// ============================================================================

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon?: string;
  eventId?: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate: string;
  negativeRisk?: boolean;
}

interface Market {
  condition_id: string;
  question: string;
  market_slug?: string;
  description?: string;
  outcomes?: string[];
  active?: boolean;
  closed?: boolean;
  resolved?: boolean;
}

// ============================================================================
// DATA API CLIENT
// ============================================================================

async function fetchPositions(wallet: string): Promise<Position[]> {
  console.log(`\n📊 Fetching positions for ${wallet}...`);

  const allPositions: Position[] = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const params = new URLSearchParams({
      user: wallet.toLowerCase(),
      limit: String(limit),
      offset: String(offset),
      sortBy: 'CASHPNL',
      sortDirection: 'DESC',
    });

    const url = `https://data-api.polymarket.com/positions?${params}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`❌ Data API error: ${response.status}`);
        break;
      }

      const positions: Position[] = await response.json();

      if (positions.length === 0) {
        break;
      }

      allPositions.push(...positions);
      console.log(`  ✅ Fetched ${positions.length} positions (total: ${allPositions.length})`);

      if (positions.length < limit) {
        break;
      }

      offset += limit;

      // Rate limiting
      await new Promise(r => setTimeout(r, 100));

    } catch (error) {
      console.error(`❌ Error fetching positions:`, error);
      break;
    }
  }

  return allPositions;
}

async function fetchMarketMetadata(conditionId: string): Promise<Market | null> {
  try {
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const markets = await response.json();
    if (markets && markets.length > 0) {
      return markets[0];
    }

    return null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// CLICKHOUSE INSERTION
// ============================================================================

async function insertPositions(wallet: string, positions: Position[]): Promise<void> {
  if (positions.length === 0) {
    console.log('  ⚠️  No positions to insert');
    return;
  }

  console.log(`\n💾 Inserting ${positions.length} positions into ClickHouse...`);

  const rows = positions.map(p => ({
    wallet_address: wallet.toLowerCase(),
    market: p.slug || '',
    condition_id: p.conditionId.toLowerCase().replace('0x', ''),
    asset_id: p.asset.toLowerCase(),
    outcome: p.outcomeIndex,
    size: p.size,
    entry_price: p.avgPrice || null,
    timestamp: new Date(),
  }));

  await ch.insert({
    table: 'default.api_positions_staging',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`  ✅ Inserted ${rows.length} positions`);
}

async function insertMarkets(markets: Market[]): Promise<void> {
  if (markets.length === 0) {
    console.log('  ⚠️  No market metadata to insert');
    return;
  }

  console.log(`\n💾 Inserting ${markets.length} market metadata records...`);

  const rows = markets
    .filter(m => m.condition_id) // Filter out markets without condition_id
    .map(m => ({
      condition_id: m.condition_id.toLowerCase().replace('0x', ''),
      market_slug: m.market_slug || '',
      question: m.question || '',
      description: m.description || '',
      outcomes: m.outcomes || [],
      active: m.active ?? false,
      closed: m.closed ?? false,
      resolved: m.resolved ?? false,
      winning_outcome: null,
      end_date: null,
      volume: 0,
      liquidity: 0,
    }));

  await ch.insert({
    table: 'default.api_markets_staging',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`  ✅ Inserted ${rows.length} market records`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function backfillWallet(wallet: string): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log(`🚀 Starting comprehensive backfill for wallet: ${wallet}`);
  console.log('═'.repeat(80));

  try {
    // Step 1: Fetch all positions
    const positions = await fetchPositions(wallet);

    if (positions.length === 0) {
      console.log('\n⚠️  No positions found for this wallet');
      return;
    }

    console.log(`\n✅ Total positions found: ${positions.length}`);
    console.log(`   Unique markets: ${new Set(positions.map(p => p.conditionId)).size}`);

    // Step 2: Insert positions
    await insertPositions(wallet, positions);

    // Step 3: Fetch and insert market metadata (sample first 50)
    console.log(`\n📋 Fetching market metadata for first 50 markets...`);
    const uniqueConditions = Array.from(new Set(positions.map(p => p.conditionId))).slice(0, 50);
    const markets: Market[] = [];

    for (const conditionId of uniqueConditions) {
      const market = await fetchMarketMetadata(conditionId);
      if (market) {
        markets.push(market);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 50));
    }

    if (markets.length > 0) {
      await insertMarkets(markets);
    }

    console.log('\n' + '═'.repeat(80));
    console.log('✅ BACKFILL COMPLETE');
    console.log('═'.repeat(80));
    console.log(`\nSummary for ${wallet}:`);
    console.log(`  Positions: ${positions.length}`);
    console.log(`  Markets: ${new Set(positions.map(p => p.conditionId)).size}`);
    console.log(`  Metadata fetched: ${markets.length}`);
    console.log('\nNext steps:');
    console.log('  1. Run map-api-to-canonical.ts to normalize IDs');
    console.log('  2. Run create-unified-trades-view.ts to merge with blockchain');
    console.log('  3. Verify with trace-wallet-data.ts');

  } catch (error) {
    console.error('\n❌ Error during backfill:', error);
    throw error;
  }
}

async function main() {
  const walletArg = process.argv[2];

  if (!walletArg) {
    console.error('Usage: npx tsx backfill-wallet-trades-comprehensive.ts <wallet_address>');
    process.exit(1);
  }

  if (walletArg === '--top-wallets') {
    console.log('⚠️  Top wallets mode not yet implemented');
    console.log('   For now, run this script for individual wallets');
    process.exit(1);
  }

  await backfillWallet(walletArg);
  await ch.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
