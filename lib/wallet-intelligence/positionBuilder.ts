/**
 * Position Builder
 * Converts raw fills into positions using weighted average cost method
 */

import type { Fill, Position, MarketSide, MarketResolution } from './types';
import { toSideSpace, outcomeToSideSpace, positionPnl, positionRoi } from './utils';
import { randomUUID } from 'crypto';

interface OpenPosition {
  tsOpen: Date;
  qty: number;
  costUsd: number;
  feesUsd: number;
  entryPxSideWeightedSum: number;
  entryQtySum: number;
  exitPxSideWeightedSum: number;
  exitQtySum: number;
  proceedsUsd: number;
  category: string;
  eventId: string;
}

export interface ResolutionLookup {
  getResolution(conditionId: string): MarketResolution | null;
}

export interface PriceLookup {
  getMidYesAt(conditionId: string, ts: Date): number | null;
}

/**
 * Build positions from fills
 * Uses weighted average cost method for entry/exit pricing
 */
export function buildPositions(
  fills: Fill[],
  resolutionLookup: ResolutionLookup,
  priceLookup: PriceLookup
): Position[] {
  // Sort fills by time
  const sorted = [...fills].sort((a, b) => a.ts_fill.getTime() - b.ts_fill.getTime());

  // Group key: wallet|condition_id|side
  const key = (f: Fill) => `${f.wallet}|${f.condition_id}|${f.side}`;
  const open = new Map<string, OpenPosition>();
  const positions: Position[] = [];

  for (const fill of sorted) {
    const k = key(fill);
    const resolution = resolutionLookup.getResolution(fill.condition_id);

    // Skip if no resolution data
    if (!resolution) continue;

    const pSide = toSideSpace(fill.side, fill.price_yes);
    let state = open.get(k);

    if (fill.action === 'BUY') {
      if (!state) {
        // Open new position
        open.set(k, {
          tsOpen: fill.ts_fill,
          qty: fill.qty_shares,
          costUsd: fill.notional_usd + fill.fee_usd,
          feesUsd: fill.fee_usd,
          entryPxSideWeightedSum: pSide * fill.qty_shares,
          entryQtySum: fill.qty_shares,
          exitPxSideWeightedSum: 0,
          exitQtySum: 0,
          proceedsUsd: 0,
          category: fill.category || '',
          eventId: fill.event_id || '',
        });
      } else {
        // Add to existing position
        state.qty += fill.qty_shares;
        state.costUsd += fill.notional_usd + fill.fee_usd;
        state.feesUsd += fill.fee_usd;
        state.entryPxSideWeightedSum += pSide * fill.qty_shares;
        state.entryQtySum += fill.qty_shares;
      }
    } else {
      // SELL reduces position
      if (!state) continue; // Can't sell what we don't have

      state.qty -= fill.qty_shares;
      state.proceedsUsd += fill.notional_usd - fill.fee_usd;
      state.feesUsd += fill.fee_usd;
      state.exitPxSideWeightedSum += pSide * fill.qty_shares;
      state.exitQtySum += fill.qty_shares;

      // Position closed via sell
      if (state.qty <= 1e-9) {
        const position = closePosition(
          fill.wallet,
          fill.condition_id,
          fill.side,
          state,
          fill.ts_fill,
          resolution,
          priceLookup,
          false // closed early
        );
        positions.push(position);
        open.delete(k);
      }
    }
  }

  // Close remaining positions at resolution
  for (const [k, state] of open.entries()) {
    const [wallet, conditionId, sideStr] = k.split('|');
    const side = sideStr as MarketSide;
    const resolution = resolutionLookup.getResolution(conditionId);

    if (!resolution) continue;

    const position = closePosition(
      wallet,
      conditionId,
      side,
      state,
      null, // held to resolution
      resolution,
      priceLookup,
      true // held to resolution
    );
    positions.push(position);
  }

  return positions;
}

function closePosition(
  wallet: string,
  conditionId: string,
  side: MarketSide,
  state: OpenPosition,
  tsClose: Date | null,
  resolution: MarketResolution,
  priceLookup: PriceLookup,
  heldToResolve: boolean
): Position {
  const avgEntryPriceSide = state.entryQtySum > 0
    ? state.entryPxSideWeightedSum / state.entryQtySum
    : 0;

  const avgExitPriceSide = state.exitQtySum > 0
    ? state.exitPxSideWeightedSum / state.exitQtySum
    : null;

  const outcomeSide = outcomeToSideSpace(side, resolution.outcome_yes);

  // Calculate proceeds
  let proceedsUsd: number;
  if (heldToResolve) {
    // Settlement: qty * outcome (1 or 0)
    proceedsUsd = state.entryQtySum * outcomeSide;
  } else {
    proceedsUsd = state.proceedsUsd;
  }

  const pnlUsd = positionPnl(state.costUsd, proceedsUsd);
  const roi = positionRoi(state.costUsd, pnlUsd);

  const tsResolve = resolution.resolved_at;
  const closeTs = tsClose || tsResolve;
  const holdMinutes = (closeTs.getTime() - state.tsOpen.getTime()) / 60000;

  // Get anchor prices for CLV
  const p_close_1h = getAnchorPrice(conditionId, side, tsResolve, 1, priceLookup);
  const p_close_4h = getAnchorPrice(conditionId, side, tsResolve, 4, priceLookup);
  const p_close_24h = getAnchorPrice(conditionId, side, tsResolve, 24, priceLookup);
  const p_close_72h = getAnchorPrice(conditionId, side, tsResolve, 72, priceLookup);

  return {
    position_id: randomUUID(),
    wallet,
    condition_id: conditionId,
    category: state.category,
    event_id: state.eventId,
    side,
    ts_open: state.tsOpen,
    ts_close: tsClose,
    ts_resolve: tsResolve,
    qty_shares: state.entryQtySum,
    entry_cost_usd: state.costUsd,
    exit_proceeds_usd: proceedsUsd,
    fees_usd: state.feesUsd,
    avg_entry_price_side: avgEntryPriceSide,
    avg_exit_price_side: avgExitPriceSide,
    outcome_side: outcomeSide,
    pnl_usd: pnlUsd,
    roi,
    hold_minutes: holdMinutes,
    p_close_1h,
    p_close_4h,
    p_close_24h,
    p_close_72h,
  };
}

function getAnchorPrice(
  conditionId: string,
  side: MarketSide,
  tsResolve: Date,
  hoursBeforeResolve: number,
  priceLookup: PriceLookup
): number | null {
  const anchorTime = new Date(tsResolve.getTime() - hoursBeforeResolve * 3600 * 1000);
  const midYes = priceLookup.getMidYesAt(conditionId, anchorTime);
  if (midYes === null) return null;
  return toSideSpace(side, midYes);
}
