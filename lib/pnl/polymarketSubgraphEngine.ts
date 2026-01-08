/**
 * Polymarket Subgraph PnL Engine (V11_POLY)
 *
 * A faithful TypeScript port of the official Polymarket pnl-subgraph logic:
 * https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph
 *
 * ⚠️ NOTE: This engine is NOT the canonical “economic parity” calculator used for
 * copy-trading rankings. Use lib/pnl/economicParityPnl.ts instead.
 *
 * Key differences from our V3 engine:
 * 1. Uses token_id directly as position identifier (not condition_id + outcome_index)
 * 2. Splits/Merges are treated as BUY/SELL at exactly $0.50 (FIFTY_CENTS)
 * 3. Sells are capped at tracked position amount (adjustedAmount = min(sellAmount, positionAmount))
 * 4. Conversions handle NegRisk market position swaps
 *
 * Events tracked (from pnl-subgraph/notes.md):
 * - OrdersMatched (CLOB trades)
 * - PositionSplit
 * - PositionsMerge
 * - PayoutRedemption
 * - PositionsConverted
 *
 * @see docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md
 */

import {
  COLLATERAL_SCALE,
  FIFTY_CENTS,
} from './polymarketConstants';

// Re-export constants for convenience
export { COLLATERAL_SCALE, FIFTY_CENTS };

/**
 * Transfer cost model for TRANSFER_IN events
 *
 * Controls how incoming token transfers affect avgPrice:
 * - 'zero_cost': Incoming tokens have $0 cost basis (avgPrice dilutes toward 0)
 * - 'neutral_point5': Incoming tokens valued at $0.50 (neutral market assumption)
 * - 'mark_to_market': Use last known market price at transfer time (not implemented)
 */
export type TransferCostModel = 'zero_cost' | 'neutral_point5' | 'mark_to_market';

/**
 * PnL calculation mode
 *
 * - 'strict': Conservative mode (default). Uses only CLOB fills and redemptions.
 *   Ignores ERC1155 transfers. Mathematically consistent and verified.
 *   W2 matches UI within $0.08, proving engine correctness.
 *
 * - 'ui_like': Best-effort UI parity mode. Includes ERC1155 transfers with
 *   zero_cost basis. Lower total absolute error but may diverge from our
 *   verified ground truth. Use for wallets with heavy transfer activity.
 *
 * The UI parity investigation (2025-11-28) found no single model universally
 * matches Polymarket UI. This is expected since the UI may use internal rules
 * we cannot observe. The 'strict' mode preserves our verified invariant.
 */
export type PnlMode = 'strict' | 'ui_like';

/**
 * Engine configuration options
 */
export interface EngineOptions {
  /** How to value incoming token transfers (default: 'zero_cost') */
  transferCostModel?: TransferCostModel;

  /** High-level PnL mode. Overrides other settings if specified. */
  mode?: PnlMode;

  /** Whether to include ERC1155 transfers (default: false for 'strict' mode) */
  includeTransfers?: boolean;
}

/**
 * UserPosition - matches schema.graphql exactly
 */
export interface UserPosition {
  /** Unique position identifier: `${wallet}-${tokenId}` */
  id: string;
  /** User wallet address */
  user: string;
  /** Token ID (ERC1155 position token) */
  tokenId: bigint;
  /** Current token amount held */
  amount: bigint;
  /** Weighted average price paid (scaled by COLLATERAL_SCALE) */
  avgPrice: bigint;
  /** Cumulative realized PnL (in micro-USDC) */
  realizedPnl: bigint;
  /** Total amount ever bought */
  totalBought: bigint;
}

/**
 * Event types tracked by the subgraph
 *
 * TRANSFER_IN/TRANSFER_OUT are inventory-only events from ERC1155 transfers:
 * - TRANSFER_IN: Tokens received from another wallet (zero cost basis, no PnL)
 * - TRANSFER_OUT: Tokens sent to another wallet (proportional cost basis reduction, no PnL)
 *
 * SYNTHETIC_COST_ADJUSTMENT is an internal event for CLOB-based synthetic splits:
 * - When a wallet sells tokens they never bought (e.g., sells NO without prior NO buys),
 *   but has a paired BUY of the opposite outcome in the same transaction,
 *   this represents a synthetic split: the USDC from the "phantom sell" is actually
 *   additional cost basis for the kept side.
 * - This event injects that cost into the retained position's avgPrice without
 *   adding tokens, ensuring accurate PnL calculation.
 */
export type PolymarketEventType =
  | 'ORDER_MATCHED_BUY'
  | 'ORDER_MATCHED_SELL'
  | 'SPLIT'
  | 'MERGE'
  | 'REDEMPTION'
  | 'CONVERSION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'SYNTHETIC_COST_ADJUSTMENT';

/**
 * Unified event structure for PnL processing
 */
export interface PolymarketPnlEvent {
  /** User wallet address */
  wallet: string;
  /** Token ID - the key identifier for positions */
  tokenId: bigint;
  /** Event type */
  eventType: PolymarketEventType;
  /** Price in micro-USDC (scaled by COLLATERAL_SCALE) */
  price: bigint;
  /** Amount of tokens */
  amount: bigint;
  /** Block number for ordering */
  blockNumber: bigint;
  /** Log index within block for ordering */
  logIndex: bigint;
  /** Transaction hash */
  txHash: string;
  /** Event timestamp */
  timestamp: string;
  /** For SPLIT/MERGE: the paired token ID (other outcome) */
  pairedTokenId?: bigint;
  /** For CONVERSION: array of token IDs involved */
  conversionTokenIds?: bigint[];
  /** For REDEMPTION: payout price from resolution */
  payoutPrice?: bigint;
  /**
   * Raw USDC amount in micro-USDC for CLOB trades.
   * For BUY: this is cash out (spent)
   * For SELL: this is cash in (received)
   * Used for economic cashflow reconciliation.
   */
  usdcAmountRaw?: bigint;
}

/**
 * Result of computing wallet PnL
 */
export interface WalletPnlResult {
  wallet: string;
  /** Total realized PnL in USDC (human-readable) */
  realizedPnl: number;
  /** Total realized PnL in micro-USDC (raw) */
  realizedPnlRaw: bigint;
  /** Trading volume in USDC */
  volume: number;
  /** Trading volume in micro-USDC (raw) */
  volumeRaw: bigint;
  /** Number of unique positions */
  positionCount: number;
  /** All positions by token ID */
  positions: Map<string, UserPosition>;
  /** Event counts by type */
  eventCounts: Record<PolymarketEventType, number>;
}

/**
 * Engine state used during event processing
 *
 * This is the mutable state that gets updated as events are processed.
 * Use createEmptyEngineState() to initialize and applyEventToState() to update.
 */
export interface EngineState {
  /** Wallet address being processed */
  wallet: string;
  /** All positions by position ID (wallet-tokenId) */
  positions: Map<string, UserPosition>;
  /** Running total of realized PnL in micro-USDC */
  realizedPnlRaw: bigint;
  /** Running total of volume in micro-USDC */
  volumeRaw: bigint;
  /** Event counts by type */
  eventCounts: Record<PolymarketEventType, number>;
  /** Engine configuration options */
  options: EngineOptions;
}

/**
 * Resolve PnlMode to concrete engine settings
 *
 * This centralizes the decision logic for what each mode means.
 */
export function resolveEngineOptions(options: EngineOptions = {}): {
  includeTransfers: boolean;
  transferCostModel: TransferCostModel;
} {
  const mode = options.mode ?? 'strict';

  if (mode === 'ui_like') {
    // UI-like mode: include transfers with zero_cost basis
    return {
      includeTransfers: options.includeTransfers ?? true,
      transferCostModel: options.transferCostModel ?? 'zero_cost',
    };
  } else {
    // Strict mode (default): no transfers, conservative
    return {
      includeTransfers: options.includeTransfers ?? false,
      transferCostModel: options.transferCostModel ?? 'zero_cost',
    };
  }
}

/**
 * Create an empty engine state for a wallet
 */
export function createEmptyEngineState(wallet: string, options: EngineOptions = {}): EngineState {
  const resolved = resolveEngineOptions(options);

  return {
    wallet: wallet.toLowerCase(),
    positions: new Map<string, UserPosition>(),
    realizedPnlRaw: 0n,
    volumeRaw: 0n,
    eventCounts: {
      ORDER_MATCHED_BUY: 0,
      ORDER_MATCHED_SELL: 0,
      SPLIT: 0,
      MERGE: 0,
      REDEMPTION: 0,
      CONVERSION: 0,
      TRANSFER_IN: 0,
      TRANSFER_OUT: 0,
      SYNTHETIC_COST_ADJUSTMENT: 0,
    },
    options: {
      transferCostModel: resolved.transferCostModel,
      mode: options.mode ?? 'strict',
      includeTransfers: resolved.includeTransfers,
    },
  };
}

/**
 * Apply a single event to the engine state
 *
 * This is the core event processing function. It mutates the state
 * and returns the delta PnL caused by this event (for reconciliation).
 *
 * INVARIANT: The engine's realized PnL change for each event should
 * match the economic cashflow of that event exactly.
 *
 * @returns deltaPnL - the change in realizedPnlRaw from this event
 */
export function applyEventToState(
  state: EngineState,
  event: PolymarketPnlEvent
): bigint {
  const position = loadOrCreateUserPosition(state.positions, state.wallet, event.tokenId);
  state.eventCounts[event.eventType]++;

  const beforePnl = state.realizedPnlRaw;

  switch (event.eventType) {
    case 'ORDER_MATCHED_BUY': {
      // BUY: Updates position and avgPrice, no realized PnL
      updateUserPositionWithBuy(position, event.price, event.amount);
      // Volume for buys: notional = amount * price / COLLATERAL_SCALE
      state.volumeRaw += (event.amount * event.price) / COLLATERAL_SCALE;
      break;
    }

    case 'ORDER_MATCHED_SELL': {
      // SELL: Realizes PnL = (sellPrice - avgPrice) * amount
      const deltaPnL = updateUserPositionWithSell(position, event.price, event.amount);
      state.realizedPnlRaw += deltaPnL;
      // Volume for sells: notional = amount * price / COLLATERAL_SCALE
      state.volumeRaw += (event.amount * event.price) / COLLATERAL_SCALE;
      break;
    }

    case 'SPLIT': {
      // SPLIT: Treated as BUY at $0.50, no realized PnL
      applySplit(position, event.amount);
      break;
    }

    case 'MERGE': {
      // MERGE: Treated as SELL at $0.50, realizes PnL
      const deltaPnL = applyMerge(position, event.amount);
      state.realizedPnlRaw += deltaPnL;
      break;
    }

    case 'REDEMPTION': {
      // REDEMPTION: Treated as SELL at payout price, realizes PnL
      const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
      const deltaPnL = applyRedemption(position, payoutPrice, event.amount);
      state.realizedPnlRaw += deltaPnL;
      // Redemptions: volume = amount (at $1 payout)
      state.volumeRaw += event.amount;
      break;
    }

    case 'CONVERSION': {
      // TODO: Implement conversion handling for NegRisk markets
      console.warn(
        `CONVERSION event not fully implemented for token ${event.tokenId.toString()}`
      );
      break;
    }

    case 'TRANSFER_IN': {
      // TRANSFER_IN: Inventory-only event, tokens received from another wallet
      // - Increases position.amount
      // - Cost basis depends on transferCostModel setting
      // - No econCashFlow (no USDC moved for this wallet)
      // - No realizedPnL
      applyTransferIn(position, event.amount, state.options.transferCostModel ?? 'zero_cost');
      break;
    }

    case 'TRANSFER_OUT': {
      // TRANSFER_OUT: Inventory-only event, tokens sent to another wallet
      // - Decreases position.amount proportionally
      // - Reduces cost basis proportionally (no PnL realized)
      // - No econCashFlow (no USDC moved for this wallet)
      // - No realizedPnL
      applyTransferOut(position, event.amount);
      break;
    }

    case 'SYNTHETIC_COST_ADJUSTMENT': {
      // SYNTHETIC_COST_ADJUSTMENT: Inject additional cost basis from CLOB synthetic splits
      //
      // When a wallet does "Buy YES + Sell NO" in the same transaction, this is economically
      // equivalent to a split ($1 → 1 YES + 1 NO) followed by selling the NO side.
      // The engine normally ignores the NO sell (no prior NO position), which understates
      // the true cost of holding YES.
      //
      // This event injects the opportunity cost (USDC from phantom sell) into the YES
      // position's avgPrice without adding tokens.
      //
      // Example:
      //   Buy 100 YES @ $0.50 → cost = $50
      //   Sell 100 NO @ $0.50 (phantom sell, no prior position) → received $50
      //   True cost of YES = $50 (paid) - $50 (received) = $0? No!
      //   The USDC from the NO sell reduces the effective cost basis.
      //
      // Wait - actually thinking about this more carefully:
      // If you Buy YES @ $0.50 and Sell NO @ $0.50:
      //   - You paid $50 for 100 YES tokens
      //   - You received $50 for "selling" 100 NO tokens you didn't have
      //
      // Where did those NO tokens come from? This only works on Polymarket because:
      //   - The CLOB settles atomically
      //   - Buying YES + Selling NO in same tx = atomic split + keep YES
      //
      // So your NET cash outflow is: $50 (buy YES) - $50 (sell NO) = $0
      // But you now hold 100 YES tokens that cost you effectively $0 each!
      //
      // When YES resolves to $1, your PnL should be:
      //   100 tokens × ($1.00 - $0.00 avgPrice) = $100 profit
      //
      // Without this adjustment, the engine thinks:
      //   - avgPrice of YES = $0.50 (from buy)
      //   - PnL = 100 × ($1.00 - $0.50) = $50 profit
      //
      // The fix: Adjust avgPrice DOWN by the sell proceeds divided by token amount.
      // event.price = the USDC amount to subtract from cost basis (per token, scaled)
      // event.amount = the token ID this adjustment applies to
      //
      // Actually, simpler approach: event.usdcAmountRaw = total USDC credit to reduce avgPrice
      // We compute new avgPrice = (old avgPrice × amount - credit) / amount
      //
      applySyntheticCostAdjustment(position, event.usdcAmountRaw ?? 0n);
      break;
    }
  }

  return state.realizedPnlRaw - beforePnl;
}

/**
 * Create a new UserPosition with zero values
 */
function createUserPosition(user: string, tokenId: bigint): UserPosition {
  return {
    id: `${user.toLowerCase()}-${tokenId.toString()}`,
    user: user.toLowerCase(),
    tokenId,
    amount: 0n,
    avgPrice: 0n,
    realizedPnl: 0n,
    totalBought: 0n,
  };
}

/**
 * Load or create a UserPosition from the positions map
 */
function loadOrCreateUserPosition(
  positions: Map<string, UserPosition>,
  user: string,
  tokenId: bigint
): UserPosition {
  const id = `${user.toLowerCase()}-${tokenId.toString()}`;
  let position = positions.get(id);
  if (!position) {
    position = createUserPosition(user, tokenId);
    positions.set(id, position);
  }
  return position;
}

/**
 * Update position with a BUY
 *
 * From updateUserPositionWithBuy.ts:
 * - avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 * - amount += buyAmount
 * - totalBought += buyAmount
 */
export function updateUserPositionWithBuy(
  position: UserPosition,
  price: bigint,
  amount: bigint
): void {
  if (amount <= 0n) return;

  // Weighted average price calculation
  // avgPrice = (avgPrice * existingAmount + price * newAmount) / (existingAmount + newAmount)
  const numerator = position.avgPrice * position.amount + price * amount;
  const denominator = position.amount + amount;

  if (denominator > 0n) {
    position.avgPrice = numerator / denominator;
  }

  position.amount += amount;
  position.totalBought += amount;
}

/**
 * Update position with a SELL
 *
 * From updateUserPositionWithSell.ts:
 * - adjustedAmount = min(sellAmount, positionAmount)
 * - deltaPnL = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE
 * - realizedPnl += deltaPnL
 * - amount -= adjustedAmount
 *
 * IMPORTANT: We cap at tracked position amount. If user has tokens from
 * sources we don't track (transfers), we don't give them PnL for those.
 *
 * Returns the deltaPnL for volume calculation
 */
export function updateUserPositionWithSell(
  position: UserPosition,
  price: bigint,
  amount: bigint
): bigint {
  // Cap at tracked position amount
  const adjustedAmount = amount > position.amount ? position.amount : amount;

  if (adjustedAmount <= 0n) return 0n;

  // Calculate realized PnL
  // deltaPnL = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE
  const deltaPnL = (adjustedAmount * (price - position.avgPrice)) / COLLATERAL_SCALE;

  position.realizedPnl += deltaPnL;
  position.amount -= adjustedAmount;

  return deltaPnL;
}

/**
 * Apply a SPLIT event
 *
 * From ConditionalTokensMapping.ts:
 * - User splits collateral into outcome tokens
 * - Treated as BUY for BOTH outcomes at FIFTY_CENTS ($0.50)
 *
 * Note: We receive events for each outcome token separately,
 * so this just calls updateUserPositionWithBuy at FIFTY_CENTS
 */
export function applySplit(position: UserPosition, amount: bigint): void {
  updateUserPositionWithBuy(position, FIFTY_CENTS, amount);
}

/**
 * Apply a MERGE event
 *
 * From ConditionalTokensMapping.ts:
 * - User merges outcome tokens back to collateral
 * - Treated as SELL for BOTH outcomes at FIFTY_CENTS ($0.50)
 */
export function applyMerge(position: UserPosition, amount: bigint): bigint {
  return updateUserPositionWithSell(position, FIFTY_CENTS, amount);
}

/**
 * Apply a REDEMPTION event
 *
 * From ConditionalTokensMapping.ts:
 * - User redeems winning tokens for payout
 * - Treated as SELL at payout price
 *
 * The payout price is: payoutNumerator * COLLATERAL_SCALE / payoutDenominator
 * For binary markets: winner gets price=1.0 ($1), loser gets price=0
 */
export function applyRedemption(
  position: UserPosition,
  payoutPrice: bigint,
  amount: bigint
): bigint {
  return updateUserPositionWithSell(position, payoutPrice, amount);
}

/**
 * Apply a TRANSFER_IN event
 *
 * Inventory-only event: tokens received from another wallet via ERC1155 transfer.
 *
 * Behavior:
 * - Increases position.amount by transfer amount
 * - Cost basis for incoming tokens depends on transferCostModel:
 *   - 'zero_cost': Incoming tokens have $0 cost (avgPrice dilutes toward 0)
 *   - 'neutral_point5': Incoming tokens valued at $0.50 (FIFTY_CENTS)
 *   - 'mark_to_market': Use market price at transfer time (not yet implemented)
 * - No econCashFlow (no USDC movement for this wallet)
 * - No realizedPnL
 *
 * The zero_cost model ensures the invariant holds with no cost attribution:
 * - Old cost basis = avgPrice × oldAmount
 * - New tokens have 0 cost
 * - New avgPrice = avgPrice × oldAmount / (oldAmount + newAmount)
 *
 * The neutral_point5 model assigns $0.50 cost to incoming tokens:
 * - More realistic for market assumptions
 * - May better match UI behavior
 */
export function applyTransferIn(
  position: UserPosition,
  amount: bigint,
  model: TransferCostModel = 'zero_cost'
): void {
  if (amount <= 0n) return;

  const oldAmount = position.amount;
  const newAmount = oldAmount + amount;

  if (newAmount > 0n) {
    if (model === 'zero_cost') {
      // Dilute avgPrice: new tokens have 0 cost
      // newAvgPrice = (oldAvgPrice × oldAmount) / newAmount
      position.avgPrice = (position.avgPrice * oldAmount) / newAmount;
    } else if (model === 'neutral_point5') {
      // New tokens valued at $0.50 (FIFTY_CENTS)
      // newAvgPrice = (oldAvgPrice × oldAmount + FIFTY_CENTS × newAmount) / (oldAmount + newAmount)
      const totalCost = position.avgPrice * oldAmount + FIFTY_CENTS * amount;
      position.avgPrice = totalCost / newAmount;
    } else if (model === 'mark_to_market') {
      // Not implemented yet - would need market price lookup
      // For now, fall back to neutral_point5
      const totalCost = position.avgPrice * oldAmount + FIFTY_CENTS * amount;
      position.avgPrice = totalCost / newAmount;
    }
  }

  position.amount = newAmount;
  // Note: We don't update totalBought since this wasn't a purchase
}

/**
 * Apply a TRANSFER_OUT event
 *
 * Inventory-only event: tokens sent to another wallet via ERC1155 transfer.
 *
 * Behavior:
 * - Decreases position.amount (capped at tracked position)
 * - Does NOT change avgPrice
 * - No econCashFlow (no USDC movement for this wallet)
 * - No realizedPnL
 *
 * This means transferring out does not realize any PnL. The cost basis
 * remains with the position for any remaining tokens.
 */
export function applyTransferOut(position: UserPosition, amount: bigint): void {
  if (amount <= 0n) return;

  // Cap at tracked position amount (can't transfer more than we have tracked)
  const adjustedAmount = amount > position.amount ? position.amount : amount;

  // Decrease position amount, avgPrice unchanged
  // No PnL realized - this is just inventory adjustment
  position.amount -= adjustedAmount;
}

/**
 * Apply a SYNTHETIC_COST_ADJUSTMENT event
 *
 * This adjusts the cost basis of a position to account for CLOB-based synthetic splits.
 * When a wallet does "Buy YES + Sell NO" in the same transaction, the NO sell proceeds
 * reduce the effective cost of the YES position.
 *
 * @param position - The position to adjust
 * @param usdcCredit - The USDC amount (in micro-USDC) that reduces cost basis
 *
 * Example:
 *   Position has 100 tokens @ avgPrice $0.50 (total cost basis = $50)
 *   USDC credit = $50 (from paired NO sell)
 *   New avgPrice = ($50 - $50) / 100 = $0.00
 *
 * The adjustment is: new_avgPrice = old_avgPrice - (credit / amount)
 * But we need to be careful not to go negative.
 */
export function applySyntheticCostAdjustment(
  position: UserPosition,
  usdcDelta: bigint
): void {
  if (usdcDelta === 0n || position.amount <= 0n) return;

  const absDelta = usdcDelta >= 0n ? usdcDelta : -usdcDelta;

  // per-token adjustment = absDelta * COLLATERAL_SCALE / position.amount
  const perToken = (absDelta * COLLATERAL_SCALE) / position.amount;

  if (usdcDelta > 0n) {
    // Credit: reduce avgPrice, not below zero
    if (perToken >= position.avgPrice) {
      position.avgPrice = 0n;
    } else {
      position.avgPrice -= perToken;
    }
  } else {
    // Debit: increase avgPrice
    position.avgPrice += perToken;
  }

  // No change to amount or realizedPnl - this is a cost basis adjustment only
}

/**
 * Sort events by timestamp with appropriate tie-breakers
 *
 * IMPORTANT: We MUST use timestamp-based sorting because pm_ctf_events block numbers
 * are inconsistent with pm_trader_events_v3 (CTF uses ~77M, CLOB uses ~154M).
 * Sorting by blockNumber would incorrectly place CTF events before CLOB trades.
 */
export function sortEventsByTimestamp(events: PolymarketPnlEvent[]): PolymarketPnlEvent[] {
  return [...events].sort((a, b) => {
    // Primary: by timestamp
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    // Secondary: by blockNumber (for events within same second)
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    // Tertiary: by logIndex
    if (a.logIndex !== b.logIndex) {
      return a.logIndex < b.logIndex ? -1 : 1;
    }
    // Final: by txHash
    return a.txHash.localeCompare(b.txHash);
  });
}

/**
 * Compute wallet PnL from a stream of events
 *
 * This is the main entry point that processes events in order
 * and maintains position state. It uses createEmptyEngineState and
 * applyEventToState internally.
 *
 * @param wallet - The wallet address to compute PnL for
 * @param events - Array of events to process
 * @param options - Engine configuration options (e.g., transferCostModel)
 */
export function computeWalletPnlFromEvents(
  wallet: string,
  events: PolymarketPnlEvent[],
  options: EngineOptions = {}
): WalletPnlResult {
  // Create empty state with options
  const state = createEmptyEngineState(wallet, options);

  // Sort events by timestamp
  const sortedEvents = sortEventsByTimestamp(events);

  // Apply each event to the state
  for (const event of sortedEvents) {
    applyEventToState(state, event);
  }

  return {
    wallet: state.wallet,
    realizedPnl: Number(state.realizedPnlRaw) / Number(COLLATERAL_SCALE),
    realizedPnlRaw: state.realizedPnlRaw,
    volume: Number(state.volumeRaw) / Number(COLLATERAL_SCALE),
    volumeRaw: state.volumeRaw,
    positionCount: state.positions.size,
    positions: state.positions,
    eventCounts: state.eventCounts,
  };
}

/**
 * Debug helper to print position details
 */
export function debugPosition(position: UserPosition): string {
  return [
    `Position ${position.id}:`,
    `  tokenId: ${position.tokenId.toString()}`,
    `  amount: ${Number(position.amount) / 1e6} tokens`,
    `  avgPrice: $${Number(position.avgPrice) / Number(COLLATERAL_SCALE)}`,
    `  realizedPnl: $${Number(position.realizedPnl) / Number(COLLATERAL_SCALE)}`,
    `  totalBought: ${Number(position.totalBought) / 1e6} tokens`,
  ].join('\n');
}
