// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

/**
 * Tax Lot Engine - Weighted Average Cost (WAC) Method
 *
 * Replays a unified ledger stream to calculate proper PnL using
 * stateful position tracking. This is the CORRECT way to calculate
 * PnL, not aggregate SQL heuristics.
 *
 * Claude 1 - PnL Calibration
 */

export interface LedgerEvent {
  wallet_address: string;
  position_id: string;
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: 'TRADE' | 'RESOLUTION';
  share_delta: number;
  cash_delta: number;
  fee_usdc: number;
  tx_hash: string;
}

export interface PositionState {
  position_id: string;
  condition_id: string;
  outcome_index: number;
  current_shares: number;
  total_cost_basis: number;
  realized_pnl: number;
  realized_gains: number;
  realized_losses: number;
  trade_count: number;
}

export interface WalletSummary {
  wallet_address: string;
  total_realized_pnl: number;
  total_gains: number;
  total_losses: number;
  positions_count: number;
  winning_positions: number;
  losing_positions: number;
}

/**
 * Tax Lot Engine using Weighted Average Cost method
 */
export class TaxLotEngine {
  private positions: Map<string, PositionState> = new Map();
  private wallet_address: string;

  constructor(wallet_address: string) {
    this.wallet_address = wallet_address;
  }

  /**
   * Process a single ledger event
   */
  processEvent(event: LedgerEvent): void {
    const posKey = event.position_id;

    // Get or create position state
    let pos = this.positions.get(posKey);
    if (!pos) {
      pos = {
        position_id: event.position_id,
        condition_id: event.condition_id,
        outcome_index: event.outcome_index,
        current_shares: 0,
        total_cost_basis: 0,
        realized_pnl: 0,
        realized_gains: 0,
        realized_losses: 0,
        trade_count: 0,
      };
      this.positions.set(posKey, pos);
    }

    pos.trade_count++;

    if (event.share_delta > 0) {
      // BUY: Increase position, add to cost basis
      const cost = Math.abs(event.cash_delta) + event.fee_usdc;
      pos.total_cost_basis += cost;
      pos.current_shares += event.share_delta;
    } else if (event.share_delta < 0) {
      // SELL or RESOLUTION: Decrease position, realize PnL
      const shares_sold = Math.abs(event.share_delta);

      // Calculate average cost per share
      const avg_price = pos.current_shares > 0
        ? pos.total_cost_basis / pos.current_shares
        : 0;

      // Cost basis released
      const cost_released = shares_sold * avg_price;

      // Proceeds (should be positive for sells)
      const proceeds = event.cash_delta;

      // Calculate PnL for this sale
      const trade_pnl = proceeds - cost_released - event.fee_usdc;

      // Update cost basis and shares
      pos.total_cost_basis -= cost_released;
      pos.current_shares -= shares_sold;

      // Track gains vs losses
      if (trade_pnl > 0) {
        pos.realized_gains += trade_pnl;
      } else {
        pos.realized_losses += Math.abs(trade_pnl);
      }
      pos.realized_pnl += trade_pnl;

      // Snap to zero if very small (dust)
      if (Math.abs(pos.current_shares) < 0.0001) {
        pos.current_shares = 0;
        pos.total_cost_basis = 0;
      }
    }
  }

  /**
   * Process multiple events in order
   */
  processEvents(events: LedgerEvent[]): void {
    // Sort by event_time, then tx_hash for determinism
    const sorted = [...events].sort((a, b) => {
      const timeCompare = a.event_time.localeCompare(b.event_time);
      if (timeCompare !== 0) return timeCompare;
      return a.tx_hash.localeCompare(b.tx_hash);
    });

    for (const event of sorted) {
      this.processEvent(event);
    }
  }

  /**
   * Get summary for the wallet
   */
  getSummary(): WalletSummary {
    let total_realized_pnl = 0;
    let total_gains = 0;
    let total_losses = 0;
    let winning_positions = 0;
    let losing_positions = 0;

    for (const pos of this.positions.values()) {
      total_realized_pnl += pos.realized_pnl;
      total_gains += pos.realized_gains;
      total_losses += pos.realized_losses;

      if (pos.realized_pnl > 0) winning_positions++;
      else if (pos.realized_pnl < 0) losing_positions++;
    }

    return {
      wallet_address: this.wallet_address,
      total_realized_pnl,
      total_gains,
      total_losses,
      positions_count: this.positions.size,
      winning_positions,
      losing_positions,
    };
  }

  /**
   * Get all position states
   */
  getPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by ID
   */
  getPosition(position_id: string): PositionState | undefined {
    return this.positions.get(position_id);
  }
}

/**
 * Extended per-market outcome stats for loss metric analysis
 */
export interface MarketOutcomeStats {
  wallet: string;
  conditionId: string;
  outcomeIndex: number;
  positionId: string;
  totalCostIn: number;      // sum of positive cash spent on this outcome
  totalCashOut: number;     // sum of positive cash received (sells + resolution)
  realizedPnl: number;      // totalCashOut - totalCostIn
  finalShares: number;      // after processing entire ledger
  isResolved: boolean;      // from join with condition resolutions
  tradeCount: number;
}

/**
 * Compute per-market outcome stats from ledger events
 */
export function computeMarketOutcomeStats(
  events: LedgerEvent[],
  resolvedConditions: Set<string>,
  wallet: string
): MarketOutcomeStats[] {
  const statsMap = new Map<string, MarketOutcomeStats>();

  // Sort events by time
  const sorted = [...events].sort((a, b) => {
    const timeCompare = a.event_time.localeCompare(b.event_time);
    if (timeCompare !== 0) return timeCompare;
    return a.tx_hash.localeCompare(b.tx_hash);
  });

  for (const event of sorted) {
    const key = event.position_id;

    let stats = statsMap.get(key);
    if (!stats) {
      stats = {
        wallet,
        conditionId: event.condition_id,
        outcomeIndex: event.outcome_index,
        positionId: event.position_id,
        totalCostIn: 0,
        totalCashOut: 0,
        realizedPnl: 0,
        finalShares: 0,
        isResolved: resolvedConditions.has(event.condition_id),
        tradeCount: 0,
      };
      statsMap.set(key, stats);
    }

    stats.tradeCount++;

    if (event.share_delta > 0) {
      // BUY: cash goes out (cash_delta is negative)
      stats.totalCostIn += Math.abs(event.cash_delta) + event.fee_usdc;
      stats.finalShares += event.share_delta;
    } else if (event.share_delta < 0) {
      // SELL or RESOLUTION: cash comes in (cash_delta is positive)
      stats.totalCashOut += event.cash_delta;
      stats.finalShares += event.share_delta; // reduces shares
    }
  }

  // Calculate realized PnL for each
  for (const stats of statsMap.values()) {
    stats.realizedPnl = stats.totalCashOut - stats.totalCostIn;
    // Snap small shares to zero
    if (Math.abs(stats.finalShares) < 0.0001) {
      stats.finalShares = 0;
    }
  }

  return Array.from(statsMap.values());
}

export default TaxLotEngine;
