/**
 * Polymarket Sync Orchestration
 *
 * Handles synchronization of market data from Polymarket to Supabase:
 * - Mutex pattern to prevent concurrent syncs
 * - Batch processing for efficient UPSERT
 * - Error recovery and logging
 * - Sync status tracking
 */

import { supabaseAdmin } from '@/lib/supabase';
import { fetchAllActiveMarkets } from './client';
import { chunk, formatDuration, getErrorMessage } from './utils';
import { SYNC_CONFIG, MUTEX_CONFIG } from './config';
import { invalidateCacheOnSync } from '@/lib/cache/cache-invalidation';
import type { SyncResult, SyncError, CascadianMarket } from '@/types/polymarket';

// ============================================================================
// Mutex Implementation (In-Memory for Phase 1)
// ============================================================================

/**
 * Simple in-memory mutex
 * Note: This works for single Vercel instance. Phase 2 will use Redis.
 */
class SyncMutex {
  private locked = false;
  private lockedAt: Date | null = null;

  /**
   * Try to acquire lock
   * Returns true if lock acquired, false if already locked
   */
  async acquire(): Promise<boolean> {
    // Check if lock is stale
    if (this.locked && this.lockedAt) {
      const age = Date.now() - this.lockedAt.getTime();
      if (age > MUTEX_CONFIG.MAX_LOCK_DURATION_MS) {
        console.warn('[Sync] Lock is stale, forcing release');
        this.release();
      }
    }

    if (this.locked) {
      return false;
    }

    this.locked = true;
    this.lockedAt = new Date();
    return true;
  }

  /**
   * Release lock
   */
  release(): void {
    this.locked = false;
    this.lockedAt = null;
  }

  /**
   * Check if locked
   */
  isLocked(): boolean {
    return this.locked;
  }
}

const syncMutex = new SyncMutex();

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Insert markets into Supabase in batches
 */
async function insertMarketsBatch(
  markets: CascadianMarket[]
): Promise<{ success: number; errors: SyncError[] }> {
  let successCount = 0;
  const errors: SyncError[] = [];

  // Process in batches
  const batches = chunk(markets, SYNC_CONFIG.BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      // Prepare data for Supabase (match database schema exactly)
      const rows = batch.map(market => ({
        market_id: market.market_id,
        title: market.title,
        description: market.description,
        slug: market.slug,
        category: market.category,
        current_price: market.current_price,
        volume_24h: market.volume_24h,
        volume_total: market.volume_total,
        liquidity: market.liquidity,
        active: market.active,
        closed: market.closed,
        end_date: market.end_date.toISOString(),
        outcomes: market.outcomes,
        condition_id: (market.raw_data as any)?.condition_id || (market.raw_data as any)?.conditionId || null,  // For CLOB API
        raw_polymarket_data: market.raw_data,  // Note: matches DB column name
        // Event information for "View Event" functionality
        // Try direct fields first (from expandEventsToMarkets), then fall back to raw_data
        event_id: (market as any).event_id || (market.raw_data as any)?.event_id || null,
        event_slug: (market as any).event_slug || (market.raw_data as any)?.event_slug || null,
        event_title: (market as any).event_title || (market.raw_data as any)?.event_title || null,
        updated_at: new Date().toISOString(),
      }));

      // UPSERT batch
      const { error } = await supabaseAdmin
        .from('markets')
        .upsert(rows, {
          onConflict: 'market_id',
        });

      if (error) {
        console.error(`[Sync] Batch ${i + 1} failed:`, error);
        errors.push({
          error: `Batch ${i + 1}: ${error.message}`,
          timestamp: new Date(),
        });
      } else {
        successCount += batch.length;
        console.log(
          `[Sync] Batch ${i + 1}/${batches.length}: ${batch.length} markets upserted`
        );
      }

    } catch (error) {
      console.error(`[Sync] Batch ${i + 1} exception:`, error);
      errors.push({
        error: `Batch ${i + 1}: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      });
    }
  }

  return { success: successCount, errors };
}

/**
 * Log sync operation to database
 */
async function logSyncOperation(
  result: SyncResult
): Promise<void> {
  try {
    await supabaseAdmin.from('sync_logs').insert({
      sync_started_at: new Date(result.timestamp.getTime() - result.duration_ms).toISOString(),
      sync_completed_at: result.timestamp.toISOString(),
      status: result.success ? 'success' : (result.markets_synced > 0 ? 'partial' : 'failed'),
      markets_synced: result.markets_synced,
      error_message: result.errors.length > 0
        ? result.errors.map(e => e.error).join('; ')
        : null,
      api_response_time_ms: null,  // Could track this separately
    });
  } catch (error) {
    console.error('[Sync] Failed to log sync operation:', error);
    // Don't throw - logging failure shouldn't break sync
  }
}

/**
 * Get latest sync timestamp from database
 */
async function getLastSyncTimestamp(): Promise<Date | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('markets')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return new Date(data.updated_at);
  } catch (error) {
    console.error('[Sync] Failed to get last sync timestamp:', error);
    return null;
  }
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Synchronize Polymarket data to Supabase
 *
 * Process:
 * 1. Acquire mutex lock
 * 2. Fetch markets from Polymarket
 * 3. Transform data
 * 4. Batch UPSERT to Supabase
 * 5. Log sync operation
 * 6. Release mutex
 *
 * Returns sync result with stats and errors
 */
export async function syncPolymarketData(): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: SyncError[] = [];

  console.log('[Sync] Starting Polymarket sync...');

  // Step 1: Acquire mutex
  const lockAcquired = await syncMutex.acquire();
  if (!lockAcquired) {
    console.warn('[Sync] Another sync is in progress, skipping');
    return {
      success: false,
      markets_synced: 0,
      errors: [{
        error: 'Sync already in progress',
        timestamp: new Date(),
      }],
      duration_ms: Date.now() - startTime,
      timestamp: new Date(),
    };
  }

  try {
    // Step 2: Fetch from Polymarket
    console.log('[Sync] Fetching markets from Polymarket...');
    let markets: CascadianMarket[];

    try {
      markets = await fetchAllActiveMarkets();
    } catch (error) {
      console.error('[Sync] Failed to fetch markets:', error);
      errors.push({
        error: `Failed to fetch markets: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      });

      // Return early on fetch failure
      const result: SyncResult = {
        success: false,
        markets_synced: 0,
        errors,
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      };

      await logSyncOperation(result);
      return result;
    }

    // Safety check
    if (markets.length > SYNC_CONFIG.MAX_MARKETS_PER_SYNC) {
      console.warn(
        `[Sync] Market count ${markets.length} exceeds safety limit ${SYNC_CONFIG.MAX_MARKETS_PER_SYNC}`
      );
      markets = markets.slice(0, SYNC_CONFIG.MAX_MARKETS_PER_SYNC);
    }

    console.log(`[Sync] Fetched ${markets.length} markets`);

    // Step 3 & 4: Transform and batch UPSERT
    console.log('[Sync] Upserting to database...');
    const { success, errors: insertErrors } = await insertMarketsBatch(markets);
    errors.push(...insertErrors);

    const duration = Date.now() - startTime;
    const result: SyncResult = {
      success: errors.length === 0,
      markets_synced: success,
      errors,
      duration_ms: duration,
      timestamp: new Date(),
    };

    console.log(
      `[Sync] Completed: ${success}/${markets.length} markets synced in ${formatDuration(duration)}`
    );

    if (errors.length > 0) {
      console.warn(`[Sync] Encountered ${errors.length} errors`);
    }

    // Step 5: Log sync operation
    await logSyncOperation(result);

    // Step 6: Invalidate cache on successful sync
    if (result.success || success > 0) {
      invalidateCacheOnSync();
      console.log('[Sync] Cache invalidated, clients will refresh on next poll');
    }

    return result;

  } finally {
    // Step 6: Always release mutex
    syncMutex.release();
  }
}

/**
 * Check if data is stale and needs sync
 */
export async function isDataStale(): Promise<boolean> {
  const lastSync = await getLastSyncTimestamp();

  if (!lastSync) {
    console.log('[Sync] No previous sync found, data is stale');
    return true;
  }

  const age = Date.now() - lastSync.getTime();
  const isStale = age > SYNC_CONFIG.STALENESS_THRESHOLD_MS;

  if (isStale) {
    console.log(
      `[Sync] Data is stale (${formatDuration(age)} old, threshold ${formatDuration(SYNC_CONFIG.STALENESS_THRESHOLD_MS)})`
    );
  }

  return isStale;
}

/**
 * Get sync status
 */
export async function getSyncStatus(): Promise<{
  last_synced: Date | null;
  is_stale: boolean;
  sync_in_progress: boolean;
}> {
  const lastSynced = await getLastSyncTimestamp();
  const isStale = await isDataStale();
  const syncInProgress = syncMutex.isLocked();

  return {
    last_synced: lastSynced,
    is_stale: isStale,
    sync_in_progress: syncInProgress,
  };
}
