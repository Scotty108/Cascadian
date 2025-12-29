/**
 * Get Wallet PnL broken down by Market and Category
 *
 * This is the solution to: "Pick a wallet, see PnL that matches Polymarket,
 * and break it down by category."
 *
 * Uses the V11_POLY engine which matches Polymarket's pnl-subgraph exactly.
 */

import { clickhouse } from '../clickhouse/client';
import { loadPolymarketPnlEventsForWallet } from './polymarketEventLoader';
import {
  computeWalletPnlFromEvents,
  COLLATERAL_SCALE,
  EngineOptions,
} from './polymarketSubgraphEngine';

export interface MarketPnl {
  conditionId: string;
  slug: string;
  question: string;
  category: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
}

export interface CategoryPnl {
  category: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  marketCount: number;
}

export interface WalletMarketPnlResult {
  wallet: string;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  byMarket: MarketPnl[];
  byCategory: CategoryPnl[];
}

/**
 * Get PnL for a wallet broken down by market and category
 *
 * @param wallet - Wallet address (proxy or EOA)
 * @param options - Engine options (default: strict mode)
 */
export async function getWalletMarketPnl(
  wallet: string,
  options: EngineOptions = {}
): Promise<WalletMarketPnlResult> {
  // 1. Load events and compute PnL using V11_POLY engine
  const eventsResult = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: true,
  });
  const result = computeWalletPnlFromEvents(wallet, eventsResult.events, options);

  // 2. Get token to market mapping with categories
  const tokenIds = Array.from(result.positions.values())
    .map((p) => p.tokenId.toString())
    .filter((t) => t !== '0');

  if (tokenIds.length === 0) {
    return {
      wallet: wallet.toLowerCase(),
      totalRealizedPnl: result.realizedPnl,
      totalUnrealizedPnl: 0,
      totalPnl: result.realizedPnl,
      byMarket: [],
      byCategory: [],
    };
  }

  // Query token mapping with categories
  const mappingRes = await clickhouse.query({
    query: `
      SELECT
        token_id_dec,
        condition_id,
        slug,
        question,
        category
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN ({tokenIds:Array(String)})
    `,
    query_params: { tokenIds },
    format: 'JSONEachRow',
  });
  const mappings = (await mappingRes.json()) as {
    token_id_dec: string;
    condition_id: string;
    slug: string;
    question: string;
    category: string;
  }[];

  // Create lookup map
  const tokenToMarket = new Map<
    string,
    { conditionId: string; slug: string; question: string; category: string }
  >();
  for (const m of mappings) {
    tokenToMarket.set(m.token_id_dec, {
      conditionId: m.condition_id,
      slug: m.slug,
      question: m.question,
      category: m.category || 'Unknown',
    });
  }

  // 3. Aggregate PnL by market (conditionId)
  const marketPnlMap = new Map<
    string,
    {
      conditionId: string;
      slug: string;
      question: string;
      category: string;
      realizedPnl: number;
      unrealizedPnl: number;
      positionCount: number;
    }
  >();

  for (const position of result.positions.values()) {
    const tokenId = position.tokenId.toString();
    const market = tokenToMarket.get(tokenId);

    if (!market) {
      // Token not in mapping - group as "Unknown"
      const key = 'unknown';
      const existing = marketPnlMap.get(key) || {
        conditionId: 'unknown',
        slug: 'unmapped-tokens',
        question: 'Tokens not in mapping',
        category: 'Unknown',
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionCount: 0,
      };
      existing.realizedPnl +=
        Number(position.realizedPnl) / Number(COLLATERAL_SCALE);
      existing.positionCount++;
      marketPnlMap.set(key, existing);
      continue;
    }

    const key = market.conditionId;
    const existing = marketPnlMap.get(key) || {
      conditionId: market.conditionId,
      slug: market.slug,
      question: market.question,
      category: market.category,
      realizedPnl: 0,
      unrealizedPnl: 0,
      positionCount: 0,
    };

    existing.realizedPnl +=
      Number(position.realizedPnl) / Number(COLLATERAL_SCALE);
    // TODO: Calculate unrealizedPnl from current position * current price
    existing.positionCount++;
    marketPnlMap.set(key, existing);
  }

  // 4. Convert to array and calculate totals
  const byMarket: MarketPnl[] = Array.from(marketPnlMap.values()).map((m) => ({
    ...m,
    totalPnl: m.realizedPnl + m.unrealizedPnl,
  }));

  // 5. Aggregate by category
  const categoryPnlMap = new Map<
    string,
    { realizedPnl: number; unrealizedPnl: number; marketCount: number }
  >();

  for (const market of byMarket) {
    const existing = categoryPnlMap.get(market.category) || {
      realizedPnl: 0,
      unrealizedPnl: 0,
      marketCount: 0,
    };
    existing.realizedPnl += market.realizedPnl;
    existing.unrealizedPnl += market.unrealizedPnl;
    existing.marketCount++;
    categoryPnlMap.set(market.category, existing);
  }

  const byCategory: CategoryPnl[] = Array.from(categoryPnlMap.entries())
    .map(([category, data]) => ({
      category,
      realizedPnl: data.realizedPnl,
      unrealizedPnl: data.unrealizedPnl,
      totalPnl: data.realizedPnl + data.unrealizedPnl,
      marketCount: data.marketCount,
    }))
    .sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl));

  // 6. Calculate totals
  const totalRealizedPnl = byMarket.reduce((sum, m) => sum + m.realizedPnl, 0);
  const totalUnrealizedPnl = byMarket.reduce(
    (sum, m) => sum + m.unrealizedPnl,
    0
  );

  return {
    wallet: wallet.toLowerCase(),
    totalRealizedPnl,
    totalUnrealizedPnl,
    totalPnl: totalRealizedPnl + totalUnrealizedPnl,
    byMarket: byMarket.sort(
      (a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl)
    ),
    byCategory,
  };
}

/**
 * Format USD for display
 */
export function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}
