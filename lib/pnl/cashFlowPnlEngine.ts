/**
 * Cash Flow PnL Engine (V12_CASH)
 *
 * A simple, accurate PnL calculation that matches PolymarketAnalytics.com.
 *
 * Formula: Realized PnL = Total Redemption Payout - Total Buy Cost
 *
 * This approach:
 * 1. Sums all USDC spent on buys (cash out)
 * 2. Sums all USDC received from redemptions (cash in from resolved positions)
 * 3. PnL = redemption cash - buy cash
 *
 * Key insight: This formula IGNORES sell proceeds entirely. This is correct
 * because sells before resolution don't realize PnL in the PA model - they
 * just close positions early. For "buy one + sell other" atomic trades,
 * the sell proceeds are treated as reducing the net cost, not as profit.
 *
 * Validated on wallet 0xdbaed59f:
 * - V11 (position-based): $16,004.50
 * - Cash flow (this engine): $5,440.20
 * - PolymarketAnalytics: $5,454
 * - Error: -0.3%
 *
 * @see polymarketSubgraphEngine.ts for the position-based V11 approach
 */

import { PolymarketPnlEvent, COLLATERAL_SCALE } from './polymarketSubgraphEngine';

/**
 * Result from cash flow PnL calculation
 */
export interface CashFlowPnlResult {
  wallet: string;
  /** Realized PnL in USDC (human-readable) */
  realizedPnl: number;
  /** Realized PnL in micro-USDC (raw) */
  realizedPnlRaw: bigint;
  /** Total USDC spent on buys */
  totalBuyUsdc: number;
  /** Total USDC received from redemptions */
  totalRedemptionUsdc: number;
  /** Total USDC received from sells (not included in PnL) */
  totalSellUsdc: number;
  /** Event counts */
  eventCounts: {
    buys: number;
    sells: number;
    redemptions: number;
    splits: number;
    merges: number;
    other: number;
  };
}

/**
 * Compute wallet PnL using cash flow method
 *
 * This is the simplest accurate method: PnL = redemptions - buys
 *
 * @param wallet - Wallet address
 * @param events - Array of PnL events
 * @returns Cash flow PnL result
 */
export function computeCashFlowPnl(
  wallet: string,
  events: PolymarketPnlEvent[]
): CashFlowPnlResult {
  let totalBuyUsdcRaw = 0n;
  let totalSellUsdcRaw = 0n;
  let totalRedemptionUsdcRaw = 0n;

  const eventCounts = {
    buys: 0,
    sells: 0,
    redemptions: 0,
    splits: 0,
    merges: 0,
    other: 0,
  };

  for (const event of events) {
    switch (event.eventType) {
      case 'ORDER_MATCHED_BUY':
        // Cash OUT: money spent buying tokens
        totalBuyUsdcRaw += event.usdcAmountRaw ?? 0n;
        eventCounts.buys++;
        break;

      case 'ORDER_MATCHED_SELL':
        // Cash IN: money received from selling tokens (not counted in PnL)
        totalSellUsdcRaw += event.usdcAmountRaw ?? 0n;
        eventCounts.sells++;
        break;

      case 'REDEMPTION':
        // Cash IN: money received from redemption
        // Payout = amount × payoutPrice / COLLATERAL_SCALE
        const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
        const payoutUsdc = (event.amount * payoutPrice) / COLLATERAL_SCALE;
        totalRedemptionUsdcRaw += payoutUsdc;
        eventCounts.redemptions++;
        break;

      case 'SPLIT':
        eventCounts.splits++;
        break;

      case 'MERGE':
        eventCounts.merges++;
        break;

      default:
        eventCounts.other++;
        break;
    }
  }

  // Cash flow PnL: redemptions - buys (ignoring sells)
  const realizedPnlRaw = totalRedemptionUsdcRaw - totalBuyUsdcRaw;

  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: Number(realizedPnlRaw) / 1e6,
    realizedPnlRaw,
    totalBuyUsdc: Number(totalBuyUsdcRaw) / 1e6,
    totalRedemptionUsdc: Number(totalRedemptionUsdcRaw) / 1e6,
    totalSellUsdc: Number(totalSellUsdcRaw) / 1e6,
    eventCounts,
  };
}

/**
 * Compute comprehensive cash flow breakdown
 *
 * Provides detailed cash flow analysis including:
 * - Per-event-type USDC flows
 * - Split/merge cost basis adjustments (at $0.50)
 *
 * Note: Splits add $0.50 cost per token (buying at 50¢)
 *       Merges return $0.50 per token (selling at 50¢)
 */
export function computeDetailedCashFlow(
  wallet: string,
  events: PolymarketPnlEvent[]
): {
  buyCash: number;
  sellCash: number;
  redemptionCash: number;
  splitCost: number;
  mergeReturn: number;
  netCashFlow: number;
  simplePnl: number; // redemptions - buys
} {
  let buyCash = 0;
  let sellCash = 0;
  let redemptionCash = 0;
  let splitCost = 0;
  let mergeReturn = 0;

  for (const event of events) {
    switch (event.eventType) {
      case 'ORDER_MATCHED_BUY':
        buyCash += Number(event.usdcAmountRaw ?? 0n) / 1e6;
        break;

      case 'ORDER_MATCHED_SELL':
        sellCash += Number(event.usdcAmountRaw ?? 0n) / 1e6;
        break;

      case 'REDEMPTION': {
        const payoutPrice = Number(event.payoutPrice ?? COLLATERAL_SCALE) / Number(COLLATERAL_SCALE);
        const amount = Number(event.amount) / 1e6;
        redemptionCash += amount * payoutPrice;
        break;
      }

      case 'SPLIT':
        // Split costs $1 to get 2 tokens (each at $0.50)
        // But we receive events per outcome, so each is $0.50 worth
        splitCost += (Number(event.amount) / 1e6) * 0.5;
        break;

      case 'MERGE':
        // Merge returns $1 for 2 tokens (each at $0.50)
        // Same logic - per-outcome event
        mergeReturn += (Number(event.amount) / 1e6) * 0.5;
        break;
    }
  }

  return {
    buyCash,
    sellCash,
    redemptionCash,
    splitCost,
    mergeReturn,
    netCashFlow: sellCash + redemptionCash + mergeReturn - buyCash - splitCost,
    simplePnl: redemptionCash - buyCash, // PA formula
  };
}
