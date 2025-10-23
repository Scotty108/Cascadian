/**
 * Seed Top Wallets - Smart Discovery Strategy
 *
 * Instead of discovering ALL wallets upfront:
 * 1. Find top 50 highest-volume markets
 * 2. Discover wallets from those markets only
 * 3. Process the top 200 wallets by volume
 *
 * This populates the whale leaderboard quickly (~2-3 min) with the most important users.
 * Other wallets are discovered on-demand when accessed.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { processWallet } from './ingest-wallet-data';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';
const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';

interface SeedStats {
  marketsScanned: number;
  walletsDiscovered: number;
  walletsProcessed: number;
  whalesFound: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

const stats: SeedStats = {
  marketsScanned: 0,
  walletsDiscovered: 0,
  walletsProcessed: 0,
  whalesFound: 0,
  errors: 0,
  startTime: new Date(),
};

/**
 * Fetch top N markets by volume
 */
async function fetchTopMarkets(limit: number = 50): Promise<any[]> {
  console.log(`\n📊 Fetching top ${limit} markets by volume...`);

  const response = await fetch(
    `${POLYMARKET_GAMMA_API}/markets?closed=false&limit=${limit}&sort=volume`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch markets: ${response.status}`);
  }

  const markets = await response.json();
  console.log(`✅ Fetched ${markets.length} high-volume markets`);

  return markets;
}

/**
 * Discover wallets from a market's recent trades
 */
async function discoverWalletsFromMarket(conditionId: string): Promise<Set<string>> {
  const wallets = new Set<string>();

  try {
    // Fetch recent trades (up to 100 most recent)
    const url = `${POLYMARKET_DATA_API}/trades?market=${conditionId}&limit=100`;
    const response = await fetch(url);

    if (response.ok) {
      const trades = await response.json();

      if (trades && Array.isArray(trades)) {
        trades.forEach((trade: any) => {
          if (trade.proxyWallet) {
            wallets.add(trade.proxyWallet.toLowerCase());
          }
        });
      }
    }
  } catch (error) {
    // Silent fail - continue with other markets
  }

  return wallets;
}

/**
 * Get wallet volumes from Polymarket to rank them
 */
async function getWalletVolume(address: string): Promise<number> {
  try {
    // This is a placeholder - Polymarket doesn't have a direct wallet volume endpoint
    // We'll need to calculate from trades or use existing database data
    const { data } = await supabase
      .from('wallets')
      .select('total_volume_usd')
      .eq('wallet_address', address)
      .single();

    return data?.total_volume_usd || 0;
  } catch {
    return 0;
  }
}

/**
 * Main seeding function
 */
async function seedTopWallets() {
  console.log('\n🌱 SMART WALLET SEEDING');
  console.log('='.repeat(60));
  console.log('Strategy: Discover top wallets from highest-volume markets');
  console.log('Target: 200 wallets in ~2-3 minutes\n');

  // Step 1: Get top markets by volume
  const topMarkets = await fetchTopMarkets(50);

  if (topMarkets.length === 0) {
    console.log('❌ No markets found. Exiting.');
    return;
  }

  // Step 2: Discover wallets from each top market
  console.log('\n🔍 Discovering wallets from top markets...');
  const allWallets = new Set<string>();

  for (let i = 0; i < topMarkets.length; i++) {
    const market = topMarkets[i];
    const conditionId = market.conditionId;

    if (!conditionId || conditionId.trim() === '') {
      stats.marketsScanned++;
      continue;
    }

    try {
      const wallets = await discoverWalletsFromMarket(conditionId);
      wallets.forEach(w => allWallets.add(w));

      stats.marketsScanned++;

      if (i % 10 === 0 && i > 0) {
        console.log(`  Progress: ${i}/${topMarkets.length} markets, ${allWallets.size} wallets found`);
      }

      // Rate limiting
      if (i % 20 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`  Error processing market ${conditionId}:`, error);
      stats.errors++;
    }
  }

  console.log(`\n✅ Discovered ${allWallets.size} unique wallets from top markets`);
  stats.walletsDiscovered = allWallets.size;

  // Step 3: Check which wallets already exist
  console.log('\n🔎 Checking existing wallets...');
  const walletArray = Array.from(allWallets);
  const existingSet = new Set<string>();

  // Query in batches
  const batchSize = 1000;
  for (let i = 0; i < walletArray.length; i += batchSize) {
    const batch = walletArray.slice(i, i + batchSize);
    const { data } = await supabase
      .from('wallets')
      .select('wallet_address')
      .in('wallet_address', batch);

    data?.forEach(row => existingSet.add(row.wallet_address));
  }

  const newWallets = walletArray.filter(w => !existingSet.has(w));
  console.log(`  📊 New wallets: ${newWallets.length}`);
  console.log(`  📊 Existing wallets: ${existingSet.size}`);

  // Step 4: Process wallets (limit to 200 to keep it fast)
  const walletsToProcess = walletArray.slice(0, 200);
  console.log(`\n⚙️  Processing top ${walletsToProcess.length} wallets...`);

  let processed = 0;
  let whales = 0;

  for (let i = 0; i < walletsToProcess.length; i++) {
    const address = walletsToProcess[i];

    try {
      console.log(`  [${i + 1}/${walletsToProcess.length}] Processing ${address.substring(0, 10)}...`);

      const result = await processWallet(address);

      if (result.success) {
        processed++;
        if (result.is_whale) {
          whales++;
        }
      }

      // Rate limiting - 2 wallets/second
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`  ❌ Failed to process ${address}: ${error.message}`);
      stats.errors++;
    }
  }

  stats.walletsProcessed = processed;
  stats.whalesFound = whales;

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
  console.log('📊 SEEDING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Markets Scanned:      ${stats.marketsScanned}`);
  console.log(`Wallets Discovered:   ${stats.walletsDiscovered}`);
  console.log(`Wallets Processed:    ${stats.walletsProcessed}`);
  console.log(`Whales Found:         ${stats.whalesFound}`);
  console.log(`Errors:               ${stats.errors}`);
  console.log(`Duration:             ${duration.toFixed(1)}s`);
  console.log(`Rate:                 ${(stats.walletsProcessed / duration).toFixed(1)} wallets/sec`);
  console.log('='.repeat(60));
  console.log('\n✅ Seeding complete! Platform ready with top wallets.\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    await seedTopWallets();
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { seedTopWallets, fetchTopMarkets, discoverWalletsFromMarket };
