/**
 * ============================================================================
 * UNREALIZED PNL ENGINE V1
 * ============================================================================
 *
 * Calculates mark-to-market value of open positions in unresolved markets.
 *
 * Definition: unrealized = sum(net_shares * current_price) - cost_basis
 *
 * Where:
 * - net_shares: Token holdings from CLOB trades (not yet resolved)
 * - current_price: Live market price from Polymarket Gamma API
 * - cost_basis: What the wallet paid for those shares
 *
 * Combined with Dome-Strict Realized, this gives Total PnL:
 *   total_pnl = dome_realized + unrealized
 *
 * Terminal: Claude 2
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { CANONICAL_TABLES, getLedgerForSurface } from './canonicalTables';

// ============================================================================
// Types
// ============================================================================

export interface OpenPosition {
  conditionId: string;
  outcomeIndex: number;
  netShares: number;
  costBasis: number;
  avgPrice: number;
}

export interface PositionWithPrice extends OpenPosition {
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface UnrealizedResult {
  wallet: string;
  unrealizedPnl: number;
  positions: PositionWithPrice[];
  stats: {
    totalPositions: number;
    totalCostBasis: number;
    totalMarketValue: number;
    unresolvedConditions: number;
  };
  pricesFetchedAt: Date;
  errors: string[];
}

// ============================================================================
// ClickHouse Client
// ============================================================================

let chClient: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!chClient) {
    chClient = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      request_timeout: 300000,
    });
  }
  return chClient;
}

export async function closeClient(): Promise<void> {
  if (chClient) {
    const client = chClient;
    chClient = null;
    await client.close();
  }
}

// ============================================================================
// Price Fetching from Polymarket Gamma API
// ============================================================================

interface MarketPrice {
  conditionId: string;
  tokenIds: string[];
  prices: number[];
  question?: string;
}

// Global cache for market prices (refreshed per calculation call)
let priceCache: Map<string, MarketPrice> | null = null;
let priceCacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Fetch current prices for all active markets from Polymarket Gamma API.
 *
 * Uses pagination to fetch all active markets and caches results.
 * Returns prices for the requested condition IDs.
 */
export async function fetchMarketPrices(
  conditionIds: string[]
): Promise<Map<string, MarketPrice>> {
  if (conditionIds.length === 0) return new Map();

  // Check cache validity
  const now = Date.now();
  if (priceCache && now - priceCacheTimestamp < CACHE_TTL_MS) {
    // Filter cache to requested condition IDs
    const result = new Map<string, MarketPrice>();
    for (const cid of conditionIds) {
      const price = priceCache.get(cid);
      if (price) result.set(cid, price);
    }
    return result;
  }

  // Refresh cache
  priceCache = new Map<string, MarketPrice>();
  priceCacheTimestamp = now;

  // Gamma API URL
  const baseUrl =
    process.env.POLYMARKET_API_URL || 'https://gamma-api.polymarket.com';

  // Fetch active markets with pagination
  let offset = 0;
  const limit = 500;
  const maxPages = 20; // Up to 10,000 markets
  let pageCount = 0;

  while (pageCount < maxPages) {
    try {
      const response = await fetch(
        `${baseUrl}/markets?limit=${limit}&offset=${offset}&closed=false`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        console.warn(`[UnrealizedPnl] Failed to fetch prices: ${response.status}`);
        break;
      }

      const markets = (await response.json()) as Array<{
        conditionId: string;
        question?: string;
        clobTokenIds: string;
        outcomePrices: string;
        closed: boolean;
      }>;

      // Stop if no more markets
      if (markets.length === 0) break;

      for (const market of markets) {
        if (!market.conditionId) continue;

        // Normalize condition ID (strip 0x, lowercase)
        const normalizedConditionId = market.conditionId
          .toLowerCase()
          .replace(/^0x/, '');

        // Parse token IDs and prices
        let tokenIds: string[] = [];
        let prices: number[] = [];

        try {
          tokenIds = JSON.parse(market.clobTokenIds || '[]');
          const rawPrices = JSON.parse(market.outcomePrices || '[]');
          prices = rawPrices.map((p: string) => parseFloat(p) || 0);
        } catch {
          // Skip if JSON parsing fails
          continue;
        }

        priceCache.set(normalizedConditionId, {
          conditionId: normalizedConditionId,
          tokenIds,
          prices,
          question: market.question,
        });
      }

      // Stop if we got fewer than limit (last page)
      if (markets.length < limit) break;

      offset += limit;
      pageCount++;

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 100));
    } catch (error: any) {
      console.warn(`[UnrealizedPnl] Price fetch error: ${error.message}`);
      break;
    }
  }

  console.log(`[UnrealizedPnl] Cached ${priceCache.size} active market prices`);

  // Filter to requested condition IDs
  const result = new Map<string, MarketPrice>();
  for (const cid of conditionIds) {
    const price = priceCache.get(cid);
    if (price) result.set(cid, price);
  }
  return result;
}

// ============================================================================
// Open Positions Calculation
// ============================================================================

/**
 * Get open positions for a wallet (shares in unresolved markets).
 *
 * Uses the CLOB ledger to sum token deltas for conditions without resolutions.
 */
export async function getOpenPositions(wallet: string): Promise<OpenPosition[]> {
  const ch = getClient();
  const ledger = getLedgerForSurface('leaderboard_v1_clob');

  // Query: Get net token positions in unresolved markets
  // Note: V9 CLOB ledger doesn't have token_id, we use condition_id + outcome_index
  const query = `
    WITH
      -- Get all CLOB activity by condition/outcome
      wallet_activity AS (
        SELECT
          condition_id,
          outcome_index,
          sum(token_delta) as net_shares,
          sum(usdc_delta) as cost_basis
        FROM ${ledger}
        WHERE lower(wallet_address) = {wallet:String}
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
        HAVING abs(net_shares) > 0.0001  -- Filter dust
      ),
      -- Filter to unresolved conditions only
      unresolved AS (
        SELECT
          wa.condition_id,
          wa.outcome_index,
          wa.net_shares,
          wa.cost_basis
        FROM wallet_activity wa
        LEFT JOIN ${CANONICAL_TABLES.RESOLUTIONS} r ON wa.condition_id = r.condition_id
        WHERE r.condition_id IS NULL
          OR r.payout_numerators IS NULL
          OR r.payout_numerators = ''
      )
    SELECT
      condition_id,
      outcome_index,
      net_shares,
      cost_basis
    FROM unresolved
    ORDER BY abs(cost_basis) DESC
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as Array<{
      condition_id: string;
      outcome_index: number;
      net_shares: string;
      cost_basis: string;
    }>;

    return rows.map((row) => ({
      conditionId: row.condition_id,
      outcomeIndex: Number(row.outcome_index),
      netShares: Number(row.net_shares),
      costBasis: Number(row.cost_basis),
      avgPrice:
        Math.abs(Number(row.net_shares)) > 0
          ? Math.abs(Number(row.cost_basis) / Number(row.net_shares))
          : 0,
    }));
  } catch (error: any) {
    console.error(`[UnrealizedPnl] Failed to get positions: ${error.message}`);
    return [];
  }
}

// ============================================================================
// Main Calculation
// ============================================================================

/**
 * Calculate unrealized PnL for a wallet.
 *
 * Formula per position:
 *   unrealized = net_shares * current_price - cost_basis
 *
 * Where cost_basis is the cumulative USDC spent (negative) or received (positive).
 */
export async function calculateUnrealizedPnl(
  wallet: string
): Promise<UnrealizedResult> {
  const errors: string[] = [];

  // Step 1: Get open positions
  const openPositions = await getOpenPositions(wallet);

  if (openPositions.length === 0) {
    return {
      wallet: wallet.toLowerCase(),
      unrealizedPnl: 0,
      positions: [],
      stats: {
        totalPositions: 0,
        totalCostBasis: 0,
        totalMarketValue: 0,
        unresolvedConditions: 0,
      },
      pricesFetchedAt: new Date(),
      errors: [],
    };
  }

  // Step 2: Get unique condition IDs
  const conditionIds = [...new Set(openPositions.map((p) => p.conditionId))];

  // Step 3: Fetch current prices
  const priceMap = await fetchMarketPrices(conditionIds);

  // Step 4: Calculate unrealized for each position
  const positionsWithPrice: PositionWithPrice[] = [];
  let totalUnrealized = 0;
  let totalCostBasis = 0;
  let totalMarketValue = 0;

  for (const pos of openPositions) {
    const marketPrice = priceMap.get(pos.conditionId);
    let currentPrice = 0;

    if (marketPrice && marketPrice.prices[pos.outcomeIndex] !== undefined) {
      currentPrice = marketPrice.prices[pos.outcomeIndex];
    } else {
      // No price available - could be resolved or delisted
      errors.push(`No price for condition ${pos.conditionId.slice(0, 8)}...`);
    }

    // Market value = shares * current price
    const marketValue = pos.netShares * currentPrice;

    // Unrealized = market value - cost basis
    // Note: costBasis from ledger is negative for buys, positive for sells
    // So if we bought shares: costBasis < 0, and unrealized = marketValue + costBasis
    const unrealized = marketValue + pos.costBasis;

    positionsWithPrice.push({
      ...pos,
      currentPrice,
      marketValue,
      unrealizedPnl: unrealized,
    });

    totalUnrealized += unrealized;
    totalCostBasis += Math.abs(pos.costBasis);
    totalMarketValue += marketValue;
  }

  return {
    wallet: wallet.toLowerCase(),
    unrealizedPnl: totalUnrealized,
    positions: positionsWithPrice,
    stats: {
      totalPositions: positionsWithPrice.length,
      totalCostBasis,
      totalMarketValue,
      unresolvedConditions: conditionIds.length,
    },
    pricesFetchedAt: new Date(),
    errors,
  };
}

// ============================================================================
// Batch Calculation
// ============================================================================

export interface UnrealizedBatchResult {
  results: UnrealizedResult[];
  summary: {
    totalWallets: number;
    successfulWallets: number;
    failedWallets: number;
    avgUnrealized: number;
    totalUnrealized: number;
  };
}

/**
 * Calculate unrealized PnL for multiple wallets.
 */
export async function batchCalculateUnrealized(
  wallets: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<UnrealizedBatchResult> {
  const results: UnrealizedResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let totalUnrealized = 0;

  for (let i = 0; i < wallets.length; i++) {
    try {
      const result = await calculateUnrealizedPnl(wallets[i]);
      results.push(result);

      if (result.errors.length === 0) {
        successCount++;
      } else {
        failCount++;
      }
      totalUnrealized += result.unrealizedPnl;
    } catch (error: any) {
      results.push({
        wallet: wallets[i].toLowerCase(),
        unrealizedPnl: 0,
        positions: [],
        stats: {
          totalPositions: 0,
          totalCostBasis: 0,
          totalMarketValue: 0,
          unresolvedConditions: 0,
        },
        pricesFetchedAt: new Date(),
        errors: [error.message],
      });
      failCount++;
    }

    if (onProgress) {
      onProgress(i + 1, wallets.length);
    }
  }

  return {
    results,
    summary: {
      totalWallets: wallets.length,
      successfulWallets: successCount,
      failedWallets: failCount,
      avgUnrealized: successCount > 0 ? totalUnrealized / successCount : 0,
      totalUnrealized,
    },
  };
}
