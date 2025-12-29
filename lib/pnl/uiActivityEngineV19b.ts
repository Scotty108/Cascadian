/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V19b (with Synthetic Resolution)
 * ============================================================================
 *
 * PURPOSE: V19 with synthetic resolution for markets at extreme prices
 *
 * DATA SOURCES:
 *   - pm_unified_ledger_v9_clob_tbl (534M+ rows, highest coverage)
 *   - pm_token_to_condition_map_v5 (latest token map)
 *
 * KEY ENHANCEMENT FROM V19:
 *   - Fetches current market prices from Gamma API for unresolved positions
 *   - Synthetic resolution: if price >= 0.99 or <= 0.01, treat as resolved
 *   - Mark-to-market: unresolved positions use current price instead of 0.5
 *
 * SYNTHETIC RESOLUTION LOGIC:
 *   - If current price >= 0.99 → winner (payout = 1.0)
 *   - If current price <= 0.01 → loser (payout = 0.0)
 *   - Otherwise → mark-to-market at current price
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV19b {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  total_trades: number;
  positions_count: number;
  markets_traded: number;
  resolutions: number;
  synthetic_resolutions: number;
  win_rate: number;
  omega_ratio: number;
  positions: PositionSummaryV19b[];
}

export interface PositionSummaryV19b {
  condition_id: string;
  outcome_index: number;
  category: string;
  cash_flow: number;
  final_tokens: number;
  resolution_price: number | null;
  current_price: number | null;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  is_synthetic_resolved: boolean;
  trade_count: number;
}

interface MarketPrice {
  conditionId: string;
  prices: number[]; // [outcome0_price, outcome1_price, ...]
}

// -----------------------------------------------------------------------------
// Price Fetching from Gamma API
// -----------------------------------------------------------------------------

let priceCache: Map<string, MarketPrice> = new Map();
let priceCacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache

async function fetchMarketPrices(conditionIds: string[]): Promise<Map<string, MarketPrice>> {
  const now = Date.now();

  // Use cache if still valid
  if (priceCache.size > 0 && (now - priceCacheTimestamp) < CACHE_TTL_MS) {
    const result = new Map<string, MarketPrice>();
    for (const cid of conditionIds) {
      const price = priceCache.get(cid);
      if (price) result.set(cid, price);
    }
    return result;
  }

  // Refresh cache from Gamma API
  priceCache = new Map();
  priceCacheTimestamp = now;

  const baseUrl = process.env.POLYMARKET_API_URL || 'https://gamma-api.polymarket.com';

  let offset = 0;
  const limit = 500;
  const maxPages = 20;
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
        console.warn(`[V19b] Failed to fetch prices: ${response.status}`);
        break;
      }

      const markets = (await response.json()) as Array<{
        conditionId: string;
        outcomePrices: string;
      }>;

      if (markets.length === 0) break;

      for (const market of markets) {
        if (!market.conditionId) continue;

        const normalizedConditionId = market.conditionId.toLowerCase().replace(/^0x/, '');

        try {
          const rawPrices = JSON.parse(market.outcomePrices || '[]');
          const prices = rawPrices.map((p: string) => parseFloat(p) || 0);

          priceCache.set(normalizedConditionId, {
            conditionId: normalizedConditionId,
            prices,
          });
        } catch {
          continue;
        }
      }

      if (markets.length < limit) break;
      offset += limit;
      pageCount++;

      await new Promise((r) => setTimeout(r, 100));
    } catch (error: any) {
      console.warn(`[V19b] Price fetch error: ${error.message}`);
      break;
    }
  }

  console.log(`[V19b] Cached ${priceCache.size} active market prices`);

  // Return prices for requested condition IDs
  const result = new Map<string, MarketPrice>();
  for (const cid of conditionIds) {
    const price = priceCache.get(cid);
    if (price) result.set(cid, price);
  }
  return result;
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

interface PositionAgg {
  condition_id: string;
  outcome_index: number;
  category: string;
  cash_flow: number;
  final_tokens: number;
  resolution_price: number | null;
  trade_count: number;
}

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  const query = `
    WITH ledger_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price,
        count() as trade_count
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      l.condition_id,
      l.outcome_index,
      COALESCE(m.category, 'Other') as category,
      l.cash_flow,
      l.final_tokens,
      l.resolution_price,
      l.trade_count
    FROM ledger_agg l
    LEFT JOIN (
      SELECT DISTINCT condition_id, category
      FROM pm_token_to_condition_map_v5
      WHERE category IS NOT NULL
    ) m ON lower(l.condition_id) = lower(m.condition_id)
    ORDER BY l.condition_id, l.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    category: r.category || 'Other',
    cash_flow: Number(r.cash_flow),
    final_tokens: Number(r.final_tokens),
    resolution_price: r.resolution_price !== null ? Number(r.resolution_price) : null,
    trade_count: Number(r.trade_count),
  }));
}

// -----------------------------------------------------------------------------
// V19b Engine with Synthetic Resolution
// -----------------------------------------------------------------------------

class V19bEngine {
  async compute(wallet: string): Promise<WalletMetricsV19b> {
    // Load position aggregates
    const aggregates = await loadPositionAggregates(wallet);

    // Find unresolved positions to fetch prices for
    const unresolvedConditionIds = aggregates
      .filter((agg) => agg.resolution_price === null)
      .map((agg) => agg.condition_id);

    // Fetch current prices for unresolved markets
    const currentPrices = unresolvedConditionIds.length > 0
      ? await fetchMarketPrices(unresolvedConditionIds)
      : new Map<string, MarketPrice>();

    const positions: PositionSummaryV19b[] = [];
    const marketsSet = new Set<string>();

    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    let volume_traded = 0;
    let total_trades = 0;
    let resolutions = 0;
    let synthetic_resolutions = 0;
    let win_count = 0;
    let loss_count = 0;

    for (const agg of aggregates) {
      marketsSet.add(agg.condition_id);
      total_trades += agg.trade_count;
      volume_traded += Math.abs(agg.cash_flow);

      const isOfficiallyResolved = agg.resolution_price !== null;
      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;
      let current_price: number | null = null;
      let is_synthetic_resolved = false;
      let effective_resolution_price: number | null = agg.resolution_price;

      if (isOfficiallyResolved) {
        // Officially resolved - use resolution_price
        pos_realized_pnl = Math.round((agg.cash_flow + agg.final_tokens * agg.resolution_price!) * 100) / 100;
        resolutions++;
      } else {
        // Unresolved - check for synthetic resolution
        const marketPrice = currentPrices.get(agg.condition_id);
        if (marketPrice && marketPrice.prices[agg.outcome_index] !== undefined) {
          current_price = marketPrice.prices[agg.outcome_index];

          // Synthetic resolution thresholds
          const SYNTHETIC_WIN_THRESHOLD = 0.99;
          const SYNTHETIC_LOSE_THRESHOLD = 0.01;

          if (current_price >= SYNTHETIC_WIN_THRESHOLD) {
            // Treat as synthetic winner
            is_synthetic_resolved = true;
            effective_resolution_price = 1.0;
            pos_realized_pnl = Math.round((agg.cash_flow + agg.final_tokens * 1.0) * 100) / 100;
            synthetic_resolutions++;
          } else if (current_price <= SYNTHETIC_LOSE_THRESHOLD) {
            // Treat as synthetic loser
            is_synthetic_resolved = true;
            effective_resolution_price = 0.0;
            pos_realized_pnl = Math.round((agg.cash_flow + agg.final_tokens * 0.0) * 100) / 100;
            synthetic_resolutions++;
          } else {
            // Mark-to-market at current price
            pos_unrealized_pnl = Math.round((agg.cash_flow + agg.final_tokens * current_price) * 100) / 100;
          }
        } else {
          // No price available - use 0.5 mark (conservative)
          pos_unrealized_pnl = Math.round((agg.cash_flow + agg.final_tokens * 0.5) * 100) / 100;
        }
      }

      // Track gains/losses for resolved (including synthetic)
      const isEffectivelyResolved = isOfficiallyResolved || is_synthetic_resolved;
      if (isEffectivelyResolved) {
        if (pos_realized_pnl > 0) {
          win_count++;
          total_gain += pos_realized_pnl;
        } else if (pos_realized_pnl < 0) {
          loss_count++;
          total_loss += pos_realized_pnl;
        }
      }

      realized_pnl += pos_realized_pnl;
      unrealized_pnl += pos_unrealized_pnl;

      positions.push({
        condition_id: agg.condition_id,
        outcome_index: agg.outcome_index,
        category: agg.category,
        cash_flow: agg.cash_flow,
        final_tokens: agg.final_tokens,
        resolution_price: effective_resolution_price,
        current_price,
        realized_pnl: pos_realized_pnl,
        unrealized_pnl: pos_unrealized_pnl,
        is_resolved: isOfficiallyResolved || is_synthetic_resolved,
        is_synthetic_resolved,
        trade_count: agg.trade_count,
      });
    }

    // Calculate aggregate metrics
    const resolvedCount = win_count + loss_count;
    const win_rate = resolvedCount > 0 ? win_count / resolvedCount : 0;
    const omega_ratio = total_loss === 0 ? (total_gain > 0 ? 100 : 1) : total_gain / Math.abs(total_loss);

    return {
      wallet,
      realized_pnl,
      unrealized_pnl,
      total_pnl: realized_pnl + unrealized_pnl,
      total_gain,
      total_loss,
      volume_traded,
      total_trades,
      positions_count: positions.length,
      markets_traded: marketsSet.size,
      resolutions,
      synthetic_resolutions,
      win_rate,
      omega_ratio,
      positions,
    };
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createV19bEngine(): V19bEngine {
  return new V19bEngine();
}

// -----------------------------------------------------------------------------
// Quick PnL calculation (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV19bPnL(wallet: string): Promise<{
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
  synthetic_resolved: number;
}> {
  const engine = new V19bEngine();
  const result = await engine.compute(wallet);

  return {
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    positions: result.positions_count,
    resolved: result.resolutions,
    synthetic_resolved: result.synthetic_resolutions,
  };
}
