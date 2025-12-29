import { computeWalletPnlFromEvents } from './polymarketSubgraphEngine';
import {
  loadPolymarketPnlEventsForWallet,
  LoaderGapStats,
  LoadPnlEventsOptions,
} from './polymarketEventLoader';

export interface UiParityPnlResult {
  wallet: string;
  realizedPnl: number;
  volume: number;
  positionCount: number;
  eventCounts: Record<string, number>;
  gapStats: LoaderGapStats;
}

export interface UiParityOptions extends LoadPnlEventsOptions {
  /** When true, synthesize redemptions for all resolved positions (default true). */
  includeSyntheticRedemptions?: boolean;
  /** Synthetic redemption mode (default 'all'). */
  syntheticRedemptionMode?: 'all' | 'losers_only';
}

/**
 * UI-Parity P&L
 *
 * Mirrors Polymarket's subgraph-style avg-cost accounting.
 * Uses synthetic redemptions to realize resolved positions.
 */
export async function computeUiParityPnl(
  wallet: string,
  options: UiParityOptions = {}
): Promise<UiParityPnlResult> {
  const {
    includeSyntheticRedemptions = true,
    syntheticRedemptionMode = 'all',
    includeTxHashSplits = false,
    includeTxHashSplitCostAdjustments = false,
    includeErc1155Transfers = false,
    logGapSummary = false,
  } = options;

  const loadResult = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions,
    syntheticRedemptionMode,
    includeTxHashSplits,
    includeTxHashSplitCostAdjustments,
    includeErc1155Transfers,
    logGapSummary,
  });

  const result = computeWalletPnlFromEvents(wallet, loadResult.events);

  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: result.realizedPnl,
    volume: result.volume,
    positionCount: result.positionCount,
    eventCounts: result.eventCounts,
    gapStats: loadResult.gapStats,
  };
}
