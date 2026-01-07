/**
 * Wallet Refresh Cron Job
 *
 * Runs every 15 minutes to:
 * 1. Discover new wallets from recent trades
 * 2. Refresh stale wallet data
 * 3. Update whale/insider scores
 *
 * This is the incremental discovery approach from the spec.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { processWallet } from '@/scripts/ingest-wallet-data';

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

interface RefreshStats {
  newWalletsDiscovered: number;
  walletsRefreshed: number;
  errors: number;
  duration: number;
}

/**
 * Discover new wallets from recent trades across top markets
 */
async function discoverRecentWallets(limit: number = 20): Promise<Set<string>> {
  const wallets = new Set<string>();

  try {
    // Get top active markets
    const response = await fetch(
      `${POLYMARKET_GAMMA_API}/markets?closed=false&limit=${limit}&sort=volume`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.status}`);
    }

    const markets = await response.json();

    // For each market, get recent trades
    for (const market of markets) {
      if (!market.conditionId) continue;

      try {
        const tradesUrl = `${POLYMARKET_DATA_API}/trades?market=${market.conditionId}&limit=50`;
        const tradesResponse = await fetch(tradesUrl);

        if (tradesResponse.ok) {
          const trades = await tradesResponse.json();

          if (trades && Array.isArray(trades)) {
            trades.forEach((trade: any) => {
              if (trade.proxyWallet) {
                wallets.add(trade.proxyWallet.toLowerCase());
              }
            });
          }
        }
      } catch (error) {
        // Continue with next market
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('[Cron] Error discovering recent wallets:', error);
  }

  return wallets;
}

/**
 * Get wallets that need refresh (stale data)
 */
async function getStaleWallets(limit: number = 50): Promise<string[]> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('wallets')
    .select('wallet_address')
    .or(`last_seen_at.lt.${sixHoursAgo},total_trades.eq.0`)
    .order('whale_score', { ascending: false }) // Prioritize whales
    .limit(limit);

  if (error) {
    console.error('[Cron] Error fetching stale wallets:', error);
    return [];
  }

  return (data || []).map(w => w.wallet_address);
}

/**
 * Check which discovered wallets are new
 */
async function filterNewWallets(addresses: string[]): Promise<string[]> {
  if (addresses.length === 0) return [];

  const { data, error } = await supabase
    .from('wallets')
    .select('wallet_address')
    .in('wallet_address', addresses);

  if (error) {
    console.error('[Cron] Error checking existing wallets:', error);
    return addresses; // Assume all new on error
  }

  const existingSet = new Set((data || []).map(w => w.wallet_address));
  return addresses.filter(addr => !existingSet.has(addr));
}

/**
 * Main refresh logic
 */
async function refreshWallets(): Promise<RefreshStats> {
  const startTime = Date.now();
  const stats: RefreshStats = {
    newWalletsDiscovered: 0,
    walletsRefreshed: 0,
    errors: 0,
    duration: 0,
  };

  console.log('\n🔄 WALLET REFRESH CRON');
  console.log('='.repeat(60));

  // Step 1: Discover new wallets from recent trades
  console.log('📊 Discovering wallets from recent trades...');
  const recentWallets = await discoverRecentWallets(20);
  console.log(`  Found ${recentWallets.size} active wallets`);

  // Filter to only new wallets
  const recentArray = Array.from(recentWallets);
  const newWallets = await filterNewWallets(recentArray);
  console.log(`  ${newWallets.length} are new`);

  // Process new wallets (limit to 20 to keep cron fast)
  const newToProcess = newWallets.slice(0, 20);
  for (const address of newToProcess) {
    try {
      console.log(`  Processing new wallet: ${address.substring(0, 10)}...`);
      const result = await processWallet(address);
      if (result.success) {
        stats.newWalletsDiscovered++;
      }
    } catch (error: any) {
      console.error(`  Failed to process ${address}:`, error.message);
      stats.errors++;
    }
  }

  // Step 2: Refresh stale wallets
  console.log('\n🔄 Refreshing stale wallets...');
  const staleWallets = await getStaleWallets(30);
  console.log(`  Found ${staleWallets.length} stale wallets`);

  for (const address of staleWallets) {
    try {
      console.log(`  Refreshing: ${address.substring(0, 10)}...`);
      const result = await processWallet(address);
      if (result.success) {
        stats.walletsRefreshed++;
      }
    } catch (error: any) {
      console.error(`  Failed to refresh ${address}:`, error.message);
      stats.errors++;
    }
  }

  stats.duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('📊 REFRESH SUMMARY');
  console.log('='.repeat(60));
  console.log(`New Wallets Discovered:  ${stats.newWalletsDiscovered}`);
  console.log(`Wallets Refreshed:       ${stats.walletsRefreshed}`);
  console.log(`Errors:                  ${stats.errors}`);
  console.log(`Duration:                ${(stats.duration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  return stats;
}

import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

/**
 * GET endpoint for Vercel Cron
 */
export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-wallets');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  try {
    const stats = await refreshWallets();

    return NextResponse.json({
      success: true,
      message: 'Wallet refresh completed',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Cron] Refresh failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for manual triggers
 */
export async function POST(request: NextRequest) {
  return GET(request);
}
