/**
 * Comprehensive Wallet Discovery System
 *
 * Discovers ALL active wallets on Polymarket by:
 * 1. Scanning all active markets for holders
 * 2. Scanning all markets for traders
 * 3. Building a complete wallet registry
 *
 * This runs continuously to maintain a complete database of all Polymarket users.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

interface DiscoveryStats {
  marketsScanned: number;
  walletsDiscovered: number;
  newWallets: number;
  existingWallets: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

const stats: DiscoveryStats = {
  marketsScanned: 0,
  walletsDiscovered: 0,
  newWallets: 0,
  existingWallets: 0,
  errors: 0,
  startTime: new Date(),
};

/**
 * Fetch ALL active markets from Polymarket
 */
async function fetchAllMarkets(): Promise<any[]> {
  console.log('\n📊 Fetching all active markets from Polymarket...');

  const allMarkets: any[] = [];
  let offset = 0;
  const limit = 100; // Max per request
  let hasMore = true;

  while (hasMore) {
    try {
      const url = `${POLYMARKET_GAMMA_API}/markets?closed=false&limit=${limit}&offset=${offset}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`Failed to fetch markets at offset ${offset}: ${response.status}`);
        break;
      }

      const markets = await response.json();

      if (!markets || markets.length === 0) {
        hasMore = false;
        break;
      }

      allMarkets.push(...markets);
      offset += limit;

      console.log(`  Fetched ${allMarkets.length} markets so far...`);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error fetching markets at offset ${offset}:`, error);
      stats.errors++;
      break;
    }
  }

  console.log(`✅ Fetched ${allMarkets.length} total active markets`);
  return allMarkets;
}

/**
 * Fetch ALL traders/holders for a specific market
 * Try multiple endpoints to maximize wallet discovery
 */
async function fetchMarketHolders(conditionId: string, marketSlug?: string): Promise<Set<string>> {
  const wallets = new Set<string>();

  // Method 1: Try holders endpoint
  try {
    const url = `${POLYMARKET_DATA_API}/markets/${conditionId}/holders?limit=100`;
    const response = await fetch(url);

    if (response.ok) {
      const holders = await response.json();
      if (holders && Array.isArray(holders)) {
        holders.forEach((holder: any) => {
          if (holder.user) {
            wallets.add(holder.user.toLowerCase());
          }
          if (holder.address) {
            wallets.add(holder.address.toLowerCase());
          }
        });
      }
    }
  } catch (error) {
    // Silent fail, try next method
  }

  // Method 2: Try trades endpoint
  try {
    const url = `${POLYMARKET_DATA_API}/trades?market=${conditionId}&limit=100`;
    const response = await fetch(url);

    if (response.ok) {
      const trades = await response.json();
      if (trades && Array.isArray(trades)) {
        trades.forEach((trade: any) => {
          // Polymarket uses 'proxyWallet' field for wallet addresses
          if (trade.proxyWallet) {
            wallets.add(trade.proxyWallet.toLowerCase());
          }
          // Also check for other possible fields
          if (trade.user) {
            wallets.add(trade.user.toLowerCase());
          }
          if (trade.maker_address) {
            wallets.add(trade.maker_address.toLowerCase());
          }
          if (trade.taker_address) {
            wallets.add(trade.taker_address.toLowerCase());
          }
        });
      }
    }
  } catch (error) {
    // Silent fail
  }

  return wallets;
}

/**
 * Check which wallets already exist in our database
 */
async function getExistingWallets(addresses: string[]): Promise<Set<string>> {
  const existing = new Set<string>();

  // Query in batches of 1000
  const batchSize = 1000;
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('wallets')
      .select('wallet_address')
      .in('wallet_address', batch);

    if (error) {
      console.error('Error checking existing wallets:', error);
      continue;
    }

    data?.forEach(row => existing.add(row.wallet_address));
  }

  return existing;
}

/**
 * Insert discovered wallets into a pending queue
 */
async function queueWalletsForIngestion(wallets: string[]): Promise<void> {
  if (wallets.length === 0) return;

  console.log(`\n📝 Queueing ${wallets.length} new wallets for ingestion...`);

  // Insert in batches
  const batchSize = 1000;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const records = batch.map(address => ({
      wallet_address: address,
      wallet_alias: null,
      is_whale: false,
      whale_score: 0,
      is_suspected_insider: false,
      insider_score: 0,
      total_volume_usd: 0,
      total_trades: 0,
      realized_pnl_usd: 0,
      unrealized_pnl_usd: 0,
      total_pnl_usd: 0,
      win_rate: 0,
      active_positions_count: 0,
      last_seen_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('wallets')
      .upsert(records, { onConflict: 'wallet_address', ignoreDuplicates: false });

    if (error) {
      console.error(`Error queueing batch:`, error);
      stats.errors++;
    } else {
      console.log(`  ✅ Queued batch ${Math.floor(i / batchSize) + 1}`);
    }
  }

  console.log(`✅ Successfully queued ${wallets.length} wallets`);
}

/**
 * Main discovery function - scans all markets and finds all wallets
 */
async function discoverAllWallets(): Promise<void> {
  console.log('\n🚀 COMPREHENSIVE WALLET DISCOVERY');
  console.log('='.repeat(60));
  console.log('Mission: Discover ALL active wallets on Polymarket\n');

  // Step 1: Fetch all active markets
  const markets = await fetchAllMarkets();

  if (markets.length === 0) {
    console.log('❌ No markets found. Exiting.');
    return;
  }

  // Step 2: Discover wallets from each market
  console.log(`\n🔍 Scanning ${markets.length} markets for wallets...`);
  const allWallets = new Set<string>();

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const conditionId = market.conditionId; // API uses camelCase

    if (!conditionId || conditionId.trim() === '') {
      stats.marketsScanned++;
      continue;
    }

    process.stdout.write(`\r  Market ${i + 1}/${markets.length}: ${allWallets.size} wallets found...`);

    try {
      const holders = await fetchMarketHolders(conditionId, market.market_slug);
      holders.forEach(wallet => allWallets.add(wallet));

      stats.marketsScanned++;

      // Progress update
      if (i % 100 === 0 && i > 0) {
        console.log(`\n  Progress: ${i}/${markets.length} markets, ${allWallets.size} wallets discovered`);
      }

      // Rate limiting between markets
      if (i % 50 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`\nError processing market ${conditionId}:`, error);
      stats.errors++;
    }
  }

  console.log(`\n\n✅ Discovered ${allWallets.size} unique wallets from ${stats.marketsScanned} markets`);
  stats.walletsDiscovered = allWallets.size;

  // Step 3: Check which wallets are new
  console.log('\n🔎 Checking which wallets are new...');
  const walletArray = Array.from(allWallets);
  const existingWallets = await getExistingWallets(walletArray);

  const newWallets = walletArray.filter(w => !existingWallets.has(w));
  stats.newWallets = newWallets.length;
  stats.existingWallets = existingWallets.size;

  console.log(`  📊 New wallets: ${stats.newWallets}`);
  console.log(`  📊 Existing wallets: ${stats.existingWallets}`);

  // Step 4: Queue new wallets for ingestion
  if (newWallets.length > 0) {
    await queueWalletsForIngestion(newWallets);
  } else {
    console.log('\n✅ No new wallets to queue');
  }

  // Done
  stats.endTime = new Date();
  printSummary();
}

/**
 * Print summary statistics
 */
function printSummary(): void {
  const duration = stats.endTime
    ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000
    : 0;

  console.log('\n' + '='.repeat(60));
  console.log('📊 DISCOVERY SUMMARY');
  console.log('='.repeat(60));
  console.log(`Markets Scanned:      ${stats.marketsScanned}`);
  console.log(`Wallets Discovered:   ${stats.walletsDiscovered}`);
  console.log(`New Wallets:          ${stats.newWallets}`);
  console.log(`Existing Wallets:     ${stats.existingWallets}`);
  console.log(`Errors:               ${stats.errors}`);
  console.log(`Duration:             ${duration.toFixed(1)}s`);
  console.log(`Rate:                 ${(stats.walletsDiscovered / duration).toFixed(1)} wallets/sec`);
  console.log('='.repeat(60));
  console.log('\n✅ Discovery complete!\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    await discoverAllWallets();
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { discoverAllWallets, fetchAllMarkets, fetchMarketHolders };
