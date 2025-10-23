/**
 * Wallet Cache Utility - On-Demand Discovery
 *
 * Ensures wallets are cached in database before accessing them.
 * If wallet doesn't exist, discovers and processes it automatically.
 *
 * Usage:
 *   const wallet = await ensureWalletCached(address)
 *   if (!wallet) throw new Error('Wallet not found')
 */

import { createClient } from '@supabase/supabase-js';
import { processWallet } from '../scripts/ingest-wallet-data';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CacheResult {
  wallet: any;
  cached: boolean; // true if was in cache, false if just discovered
  processed: boolean; // true if had data, false if was empty shell
}

/**
 * Ensure wallet is cached in database
 * If not found, discovers and processes it
 */
export async function ensureWalletCached(address: string): Promise<CacheResult | null> {
  if (!address || address.trim() === '') {
    return null;
  }

  const normalizedAddress = address.toLowerCase();

  // Step 1: Check if wallet exists in database
  const { data: existing, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('wallet_address', normalizedAddress)
    .single();

  // If exists and has data (total_trades > 0), return cached
  if (existing && !error && existing.total_trades > 0) {
    return {
      wallet: existing,
      cached: true,
      processed: true,
    };
  }

  // If exists but empty (never processed), re-process
  if (existing && !error && existing.total_trades === 0) {
    console.log(`[Cache] Re-processing empty wallet: ${normalizedAddress}`);
    try {
      const result = await processWallet(normalizedAddress);
      if (result.success) {
        const { data: refreshed } = await supabase
          .from('wallets')
          .select('*')
          .eq('wallet_address', normalizedAddress)
          .single();

        return {
          wallet: refreshed,
          cached: false,
          processed: true,
        };
      }
    } catch (error) {
      console.error(`[Cache] Failed to re-process wallet:`, error);
      // Return empty wallet
      return {
        wallet: existing,
        cached: true,
        processed: false,
      };
    }
  }

  // Step 2: Wallet doesn't exist - discover and process
  console.log(`[Cache] Discovering new wallet: ${normalizedAddress}`);

  try {
    const result = await processWallet(normalizedAddress);

    if (result.success) {
      const { data: newWallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('wallet_address', normalizedAddress)
        .single();

      return {
        wallet: newWallet,
        cached: false,
        processed: true,
      };
    }

    // Processing failed but wallet may have been created
    const { data: fallback } = await supabase
      .from('wallets')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (fallback) {
      return {
        wallet: fallback,
        cached: false,
        processed: false,
      };
    }

    return null;
  } catch (error) {
    console.error(`[Cache] Failed to discover wallet:`, error);
    return null;
  }
}

/**
 * Batch ensure wallets are cached
 * Processes in parallel with concurrency limit
 */
export async function ensureWalletsCached(
  addresses: string[],
  concurrency: number = 5
): Promise<Map<string, any>> {
  const results = new Map<string, any>();

  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const result = await ensureWalletCached(address);
        return { address: address.toLowerCase(), result };
      })
    );

    batchResults.forEach(({ address, result }) => {
      if (result?.wallet) {
        results.set(address, result.wallet);
      }
    });
  }

  return results;
}

/**
 * Check if wallet needs refresh (data is stale)
 */
export function needsRefresh(wallet: any, maxAge: number = 6 * 60 * 60 * 1000): boolean {
  if (!wallet.last_seen_at) return true;

  const lastUpdate = new Date(wallet.last_seen_at).getTime();
  const age = Date.now() - lastUpdate;

  return age > maxAge;
}

/**
 * Refresh wallet data if stale
 */
export async function refreshWalletIfStale(address: string): Promise<any> {
  const result = await ensureWalletCached(address);

  if (!result) return null;

  // If data is stale, refresh
  if (needsRefresh(result.wallet)) {
    console.log(`[Cache] Refreshing stale wallet: ${address}`);
    await processWallet(address);

    const { data: refreshed } = await supabase
      .from('wallets')
      .select('*')
      .eq('wallet_address', address.toLowerCase())
      .single();

    return refreshed;
  }

  return result.wallet;
}
