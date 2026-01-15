/**
 * FIFO Breakdown Utility
 *
 * Computes per-trade FIFO cost basis breakdown for position display.
 * Uses weighted average cost basis (matching costBasisEngineV1.ts approach).
 * Supports tracking both YES and NO tokens separately for complete market view.
 */

export interface RawTrade {
  event_id: string;
  side: string;      // 'buy' or 'sell'
  usdc_amount: number;
  shares: number;
  price: number;
  action: string;    // 'maker' or 'taker'
  trade_time: string;
}

export interface RawTradeWithOutcome extends RawTrade {
  outcome_index: number;  // 0 = YES, 1 = NO
}

export interface TradeWithFifo {
  event_id: string;
  trade_time: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';  // Which token this trade is for
  shares: number;
  price: number;
  cost_usd: number;
  proceeds_usd: number;
  matched_cost_basis: number | null;  // For sells: the cost basis matched
  realized_pnl: number | null;        // For sells: proceeds - matched_cost
  roi: number | null;                 // For sells: realized_pnl / matched_cost
  running_position: number;           // Running total shares after this trade
  running_avg_cost: number;           // Running average cost per share
  action: string;
}

/**
 * Computes FIFO breakdown for a list of trades.
 * Uses weighted average cost basis for simplicity and consistency
 * with existing PnL engines.
 */
export function computeFifoBreakdown(rawTrades: RawTrade[]): TradeWithFifo[] {
  // State for tracking position
  let position = 0;        // Current number of shares
  let costBasis = 0;       // Total cost basis

  const result: TradeWithFifo[] = [];

  for (const trade of rawTrades) {
    const isBuy = trade.side.toLowerCase() === 'buy';
    const shares = Math.abs(trade.shares || 0);
    const usdcAmount = Math.abs(trade.usdc_amount || 0);
    const price = trade.price || (shares > 0 ? usdcAmount / shares : 0);

    if (isBuy) {
      // BUY: Add to position, update cost basis
      position += shares;
      costBasis += usdcAmount;

      const avgCost = position > 0 ? costBasis / position : 0;

      result.push({
        event_id: trade.event_id,
        trade_time: trade.trade_time,
        side: 'BUY',
        outcome: 'YES', // Default for legacy single-outcome usage
        shares,
        price,
        cost_usd: usdcAmount,
        proceeds_usd: 0,
        matched_cost_basis: null,
        realized_pnl: null,
        roi: null,
        running_position: position,
        running_avg_cost: avgCost,
        action: trade.action,
      });
    } else {
      // SELL: Realize PnL using weighted average cost
      const avgCost = position > 0 ? costBasis / position : 0;

      // Cap sell at current position (handle phantom tokens)
      const effectiveShares = Math.min(shares, position);
      const matchedCost = effectiveShares * avgCost;
      const proceeds = usdcAmount;
      const realizedPnl = proceeds - matchedCost;
      const roi = matchedCost > 0 ? realizedPnl / matchedCost : 0;

      // Update position and cost basis
      if (effectiveShares > 0) {
        costBasis -= matchedCost;
        position -= effectiveShares;
      }

      // Handle sells that exceed position (phantom tokens)
      if (shares > effectiveShares) {
        // These are "free money" - tokens from unknown source
        // Still track them but with 0 cost basis
      }

      const newAvgCost = position > 0 ? costBasis / position : 0;

      result.push({
        event_id: trade.event_id,
        trade_time: trade.trade_time,
        side: 'SELL',
        outcome: 'YES', // Default for legacy single-outcome usage
        shares,
        price,
        cost_usd: 0,
        proceeds_usd: proceeds,
        matched_cost_basis: matchedCost,
        realized_pnl: realizedPnl,
        roi,
        running_position: position,
        running_avg_cost: newAvgCost,
        action: trade.action,
      });
    }
  }

  return result;
}

/**
 * Computes FIFO breakdown for trades across both YES and NO outcomes.
 * Tracks each outcome's position separately, returns trades in chronological order.
 *
 * For "phantom" sells (selling tokens without prior buys), we infer cost basis
 * using the complement's average price. This handles the common "mint and sell"
 * pattern where traders mint complete sets and sell the unwanted side.
 */
export function computeFifoBreakdownByOutcome(rawTrades: RawTradeWithOutcome[]): TradeWithFifo[] {
  // Track position and cost basis separately for each outcome
  const state = {
    YES: { position: 0, costBasis: 0, avgBuyPrice: 0 },
    NO: { position: 0, costBasis: 0, avgBuyPrice: 0 },
  };

  // First pass: calculate average buy prices for each outcome
  // This helps infer cost basis for phantom sells using complement
  let yesBuyTotal = 0, yesBuyShares = 0;
  let noBuyTotal = 0, noBuyShares = 0;

  for (const trade of rawTrades) {
    if (trade.side.toLowerCase() === 'buy') {
      const shares = Math.abs(trade.shares || 0);
      const usdcAmount = Math.abs(trade.usdc_amount || 0);
      if (trade.outcome_index === 0) {
        yesBuyTotal += usdcAmount;
        yesBuyShares += shares;
      } else {
        noBuyTotal += usdcAmount;
        noBuyShares += shares;
      }
    }
  }

  // Calculate average buy prices (used for inferring phantom sell cost basis)
  const avgYesBuyPrice = yesBuyShares > 0 ? yesBuyTotal / yesBuyShares : 0;
  const avgNoBuyPrice = noBuyShares > 0 ? noBuyTotal / noBuyShares : 0;

  const result: TradeWithFifo[] = [];

  for (const trade of rawTrades) {
    const isBuy = trade.side.toLowerCase() === 'buy';
    const shares = Math.abs(trade.shares || 0);
    const usdcAmount = Math.abs(trade.usdc_amount || 0);
    const price = trade.price || (shares > 0 ? usdcAmount / shares : 0);
    const outcome: 'YES' | 'NO' = trade.outcome_index === 0 ? 'YES' : 'NO';
    const outcomeState = state[outcome];

    if (isBuy) {
      // BUY: Add to position, update cost basis
      outcomeState.position += shares;
      outcomeState.costBasis += usdcAmount;

      const avgCost = outcomeState.position > 0 ? outcomeState.costBasis / outcomeState.position : 0;

      result.push({
        event_id: trade.event_id,
        trade_time: trade.trade_time,
        side: 'BUY',
        outcome,
        shares,
        price,
        cost_usd: usdcAmount,
        proceeds_usd: 0,
        matched_cost_basis: null,
        realized_pnl: null,
        roi: null,
        running_position: outcomeState.position,
        running_avg_cost: avgCost,
        action: trade.action,
      });
    } else {
      // SELL: Realize PnL using weighted average cost
      const avgCost = outcomeState.position > 0 ? outcomeState.costBasis / outcomeState.position : 0;

      // Cap sell at current position (handle phantom tokens)
      const effectiveShares = Math.min(shares, outcomeState.position);
      let matchedCost = effectiveShares * avgCost;
      const proceeds = usdcAmount;

      // For "phantom" sells (selling tokens we didn't buy), infer cost basis
      // from the complement's average buy price. If we bought YES at 91¢,
      // then minted NO tokens effectively cost us 9¢ each (100¢ - 91¢).
      // This handles the "mint and sell complement" pattern.
      const phantomShares = shares - effectiveShares;
      let inferredCostBasis = 0;
      if (phantomShares > 0) {
        // Use complement's average buy price to infer cost basis
        // If selling NO without buying NO, but we bought YES at avgYesBuyPrice,
        // then NO cost basis = 1 - avgYesBuyPrice
        const complementAvgPrice = outcome === 'YES' ? avgNoBuyPrice : avgYesBuyPrice;
        if (complementAvgPrice > 0) {
          // Inferred cost per phantom share = 1 - complement price
          const inferredCostPerShare = Math.max(0, 1 - complementAvgPrice);
          inferredCostBasis = phantomShares * inferredCostPerShare;
        } else {
          // Fallback: use sale price as fair value (will give ~0% ROI)
          inferredCostBasis = phantomShares * price;
        }
        matchedCost += inferredCostBasis;
      }

      const realizedPnl = proceeds - matchedCost;
      const roi = matchedCost > 0 ? realizedPnl / matchedCost : null;

      // Update position and cost basis
      if (effectiveShares > 0) {
        outcomeState.costBasis -= effectiveShares * avgCost;
        outcomeState.position -= effectiveShares;
      }

      const newAvgCost = outcomeState.position > 0 ? outcomeState.costBasis / outcomeState.position : 0;

      result.push({
        event_id: trade.event_id,
        trade_time: trade.trade_time,
        side: 'SELL',
        outcome,
        shares,
        price,
        cost_usd: 0,
        proceeds_usd: proceeds,
        matched_cost_basis: matchedCost > 0 ? matchedCost : null,
        realized_pnl: matchedCost > 0 ? realizedPnl : null,
        roi,
        running_position: Math.max(0, outcomeState.position), // Never go negative
        running_avg_cost: newAvgCost,
        action: trade.action,
      });
    }
  }

  return result;
}
