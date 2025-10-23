/**
 * Polymarket Trade Data Aggregator
 *
 * Fetches trade data from Polymarket CLOB API and calculates market analytics:
 * - Trade counts and volume
 * - Unique buyer/seller counts
 * - Buy/Sell ratio (sentiment)
 * - Momentum score (price velocity)
 * - Price change percentage
 *
 * Similar to hashdive.com analytics implementation
 *
 * Data Source: https://data-api.polymarket.com/trades
 * Query Params:
 *   - slug: market slug (e.g., "will-bitcoin-hit-100k")
 *   - limit: max 10,000 per request
 *   - offset: pagination offset
 *
 * Usage:
 *   - Run via cron job: aggregateAllMarkets()
 *   - Single market: aggregateMarketTrades(marketId, slug)
 */

import { supabaseAdmin } from '@/lib/supabase';

// =====================================================================
// TYPES
// =====================================================================

/**
 * Trade object from Polymarket CLOB API
 */
interface CLOBTrade {
  proxyWallet: string;    // Unique wallet address
  side: 'BUY' | 'SELL';   // Trade side
  size: number;           // Trade size (shares)
  price: number;          // Trade price (0-1)
  timestamp: number;      // Unix timestamp (seconds)
  conditionId: string;    // Market condition ID
}

/**
 * Aggregated market analytics
 */
interface MarketAnalytics {
  market_id: string;
  condition_id: string;
  trades_24h: number;
  buyers_24h: number;
  sellers_24h: number;
  buy_sell_ratio: number;
  buy_volume_24h: number;
  sell_volume_24h: number;
  momentum_score: number;
  price_change_24h: number;
}

/**
 * Aggregation result for batch processing
 */
interface AggregationResult {
  success: boolean;
  processed: number;
  failed: number;
  duration_ms: number;
}

// =====================================================================
// CONSTANTS
// =====================================================================

const CLOB_API_BASE_URL = 'https://data-api.polymarket.com';
const TRADES_ENDPOINT = '/trades';
const MAX_TRADES_PER_REQUEST = 1000; // API limit
const MAX_TRADES_TOTAL = 10000; // Safety limit per market
const BATCH_SIZE = 10; // Markets to process in parallel
const BATCH_DELAY_MS = 2000; // Delay between batches (rate limiting)
const HOURS_24 = 24 * 60 * 60; // 24 hours in seconds

// =====================================================================
// CLOB API CLIENT
// =====================================================================

/**
 * Fetch trades for a specific market from CLOB API
 *
 * @param conditionId - Polymarket condition ID (blockchain identifier)
 * @param hours - Time window in hours (default 24)
 * @returns Array of trades within the time window
 */
async function fetchMarketTrades(
  conditionId: string,
  hours: number = 24
): Promise<CLOBTrade[]> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - (hours * 60 * 60);

  let allTrades: CLOBTrade[] = [];
  let offset = 0;
  const limit = MAX_TRADES_PER_REQUEST;

  console.log(`[Trade Aggregator] Fetching trades for condition ${conditionId.slice(0, 10)}...`);

  while (true) {
    const url = `${CLOB_API_BASE_URL}${TRADES_ENDPOINT}?market=${conditionId}&limit=${limit}&offset=${offset}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[Trade Aggregator] Rate limited for condition ${conditionId.slice(0, 10)}..., retrying after delay...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        console.error(`[Trade Aggregator] API error ${response.status} for condition ${conditionId.slice(0, 10)}...`);
        break;
      }

      const trades: CLOBTrade[] = await response.json();

      // Filter to time window
      const recentTrades = trades.filter(t => t.timestamp >= since);
      allTrades.push(...recentTrades);

      console.log(`[Trade Aggregator] Fetched ${trades.length} trades (${recentTrades.length} in window) at offset ${offset}`);

      // Stop conditions:
      // 1. No more trades returned
      // 2. All trades are outside time window
      // 3. Reached safety limit
      if (trades.length < limit || recentTrades.length === 0 || offset >= MAX_TRADES_TOTAL) {
        break;
      }

      offset += limit;

    } catch (error) {
      console.error(`[Trade Aggregator] Fetch error for condition ${conditionId.slice(0, 10)}...:`, error);
      break;
    }
  }

  console.log(`[Trade Aggregator] Total trades fetched: ${allTrades.length}`);
  return allTrades;
}

// =====================================================================
// ANALYTICS CALCULATION
// =====================================================================

/**
 * Calculate market analytics from trades
 *
 * Metrics:
 * - Trade counts
 * - Unique buyer/seller counts
 * - Buy/Sell volume and ratio
 * - Momentum (price velocity)
 * - Price change percentage
 *
 * @param marketId - Internal market ID
 * @param conditionId - Polymarket condition ID
 * @param trades - Array of trades to analyze
 * @returns Calculated analytics
 */
function calculateAnalytics(
  marketId: string,
  conditionId: string,
  trades: CLOBTrade[]
): MarketAnalytics {
  // Handle empty trade set
  if (trades.length === 0) {
    return {
      market_id: marketId,
      condition_id: conditionId,
      trades_24h: 0,
      buyers_24h: 0,
      sellers_24h: 0,
      buy_sell_ratio: 1.0,
      buy_volume_24h: 0,
      sell_volume_24h: 0,
      momentum_score: 0,
      price_change_24h: 0,
    };
  }

  // Count unique wallets by side
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  let buyVolume = 0;
  let sellVolume = 0;

  trades.forEach(trade => {
    const volume = trade.size * trade.price;

    if (trade.side === 'BUY') {
      buyers.add(trade.proxyWallet);
      buyVolume += volume;
    } else {
      sellers.add(trade.proxyWallet);
      sellVolume += volume;
    }
  });

  // Calculate buy/sell ratio
  // Prevent division by zero: if no sellers, ratio = buyers (or 1 if no buyers)
  const buyCount = buyers.size;
  const sellCount = sellers.size || 1; // Prevent division by zero
  const buyAdjusted = buyCount || 1; // If both are 0, ratio = 1
  const buySellRatio = buyAdjusted / sellCount;

  // Calculate price change and momentum
  // Sort trades chronologically
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const firstPrice = sortedTrades[0]?.price || 0;
  const lastPrice = sortedTrades[sortedTrades.length - 1]?.price || 0;
  const priceChange = lastPrice - firstPrice;

  // Momentum: price change per hour, scaled by 100 for readability
  // Formula: (price_change / time_span_hours) * 100
  const firstTimestamp = sortedTrades[0]?.timestamp || 0;
  const lastTimestamp = sortedTrades[sortedTrades.length - 1]?.timestamp || 0;
  const timeSpanSeconds = Math.max(1, lastTimestamp - firstTimestamp);
  const timeSpanHours = timeSpanSeconds / 3600;
  const momentum = (priceChange / timeSpanHours) * 100;

  return {
    market_id: marketId,
    condition_id: conditionId,
    trades_24h: trades.length,
    buyers_24h: buyers.size,
    sellers_24h: sellers.size,
    buy_sell_ratio: parseFloat(buySellRatio.toFixed(4)),
    buy_volume_24h: parseFloat(buyVolume.toFixed(2)),
    sell_volume_24h: parseFloat(sellVolume.toFixed(2)),
    momentum_score: parseFloat(momentum.toFixed(4)),
    price_change_24h: parseFloat((priceChange * 100).toFixed(4)), // as percentage
  };
}

// =====================================================================
// AGGREGATION FUNCTIONS
// =====================================================================

/**
 * Aggregate trades for a single market
 *
 * Fetches trades from CLOB API, calculates analytics, and stores in database
 *
 * @param marketId - Internal market ID
 * @param conditionId - Polymarket condition ID (blockchain identifier)
 * @returns Calculated analytics
 */
export async function aggregateMarketTrades(
  marketId: string,
  conditionId: string
): Promise<MarketAnalytics> {
  console.log(`[Trade Aggregator] Processing market ${marketId}...`);

  try {
    // Fetch trades from CLOB API using conditionId
    const trades = await fetchMarketTrades(conditionId, 24);

    // Calculate analytics
    const analytics = calculateAnalytics(marketId, conditionId, trades);

    // Upsert to database
    const { error } = await supabaseAdmin
      .from('market_analytics')
      .upsert({
        ...analytics,
        last_aggregated_at: new Date().toISOString(),
      }, {
        onConflict: 'market_id'
      });

    if (error) {
      console.error(`[Trade Aggregator] Failed to save analytics for ${marketId}:`, error);
      throw error;
    }

    console.log(`[Trade Aggregator] ✅ Saved analytics for ${marketId}: ${trades.length} trades, ${analytics.buyers_24h} buyers, ${analytics.sellers_24h} sellers`);

    return analytics;

  } catch (error) {
    console.error(`[Trade Aggregator] Error processing ${marketId}:`, error);
    throw error;
  }
}

/**
 * Aggregate all active markets
 *
 * Fetches top markets by volume and aggregates trade data for each
 * Processes in batches to avoid rate limiting
 *
 * Intended to be run as a cron job every hour
 *
 * @param marketLimit - Maximum number of markets to process (default 100)
 * @returns Aggregation result summary
 */
export async function aggregateAllMarkets(
  marketLimit: number = 100
): Promise<AggregationResult> {
  console.log('[Trade Aggregator] Starting aggregation for all markets...');

  const startTime = Date.now();

  // Fetch active markets ordered by volume
  // Focus on top markets first (highest volume = most important)
  // Extract conditionId from raw_polymarket_data JSONB column
  const { data: markets, error } = await supabaseAdmin
    .from('markets')
    .select('market_id, raw_polymarket_data')
    .eq('active', true)
    .eq('closed', false)
    .not('raw_polymarket_data', 'is', null)
    .order('volume_24h', { ascending: false })
    .limit(marketLimit);

  if (error || !markets) {
    console.error('[Trade Aggregator] Failed to fetch markets:', error);
    throw new Error('Failed to fetch markets from database');
  }

  console.log(`[Trade Aggregator] Processing ${markets.length} markets in batches of ${BATCH_SIZE}...`);

  let successCount = 0;
  let failCount = 0;

  // Process markets in batches to avoid rate limits
  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(markets.length / BATCH_SIZE);

    console.log(`[Trade Aggregator] Processing batch ${batchNum}/${totalBatches}...`);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (market) => {
        try {
          // Extract conditionId from raw_polymarket_data JSONB
          const conditionId = (market.raw_polymarket_data as any)?.conditionId;
          if (!conditionId) {
            console.warn(`[Trade Aggregator] Market ${market.market_id} has no conditionId, skipping`);
            return { success: false, marketId: market.market_id };
          }

          await aggregateMarketTrades(market.market_id, conditionId);
          return { success: true, marketId: market.market_id };
        } catch (error) {
          console.error(`[Trade Aggregator] Failed to aggregate ${market.market_id}:`, error);
          return { success: false, marketId: market.market_id };
        }
      })
    );

    // Count successes and failures
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        failCount++;
      }
    });

    // Rate limiting: delay between batches
    if (i + BATCH_SIZE < markets.length) {
      console.log(`[Trade Aggregator] Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const duration = Date.now() - startTime;

  console.log(`[Trade Aggregator] Complete: ${successCount} success, ${failCount} failed in ${duration}ms`);

  return {
    success: true,
    processed: successCount,
    failed: failCount,
    duration_ms: duration,
  };
}

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

/**
 * Check if analytics are stale and need updating
 *
 * @param thresholdHours - Hours before data is considered stale (default 1)
 * @returns True if analytics need updating
 */
export async function areAnalyticsStale(thresholdHours: number = 1): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .rpc('are_analytics_stale', { threshold_hours: thresholdHours });

  if (error) {
    console.error('[Trade Aggregator] Failed to check staleness:', error);
    return true; // Assume stale on error
  }

  return data as boolean;
}

/**
 * Get analytics staleness (time since last update)
 *
 * @returns Staleness interval as string (e.g., "2 hours 30 minutes")
 */
export async function getAnalyticsStaleness(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .rpc('get_analytics_staleness');

  if (error) {
    console.error('[Trade Aggregator] Failed to get staleness:', error);
    return null;
  }

  return data as string;
}
