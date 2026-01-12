/**
 * Per-Trade Metrics Engine
 * Calculates PnL and ROI at the individual trade level using FIFO cost basis
 */

import type { MarketSide } from './types';
import { toSideSpace, outcomeToSideSpace } from './utils';

export interface RawTrade {
  trade_id: string;
  ts: Date;
  wallet: string;
  condition_id: string;
  token_id: string;
  outcome_index: number;
  side: MarketSide;
  action: 'BUY' | 'SELL';
  price_yes: number;
  qty: number;
  notional_usd: number;
  fee_usd: number;
  category?: string;
  event_id?: string;
}

export interface TradeWithPnL {
  trade_id: string;
  ts: Date;
  wallet: string;
  condition_id: string;
  side: MarketSide;
  action: 'BUY' | 'SELL';
  qty: number;
  price_side: number; // Entry price in side space
  notional_usd: number;
  fee_usd: number;
  // Realized metrics (for sells or resolved buys)
  cost_basis_usd: number | null; // For sells: FIFO cost of tokens sold
  realized_pnl_usd: number | null;
  realized_roi: number | null;
  // For CLV
  clv_1h: number | null;
  clv_4h: number | null;
  clv_24h: number | null;
  clv_72h: number | null;
  // Resolution
  outcome_side: 0 | 1 | null;
  is_resolved: boolean;
  category: string;
  event_id: string;
}

interface FIFOLot {
  qty: number;
  cost_per_share: number;
  ts: Date;
}

interface Resolution {
  resolved_at: Date;
  outcome_yes: 0 | 1;
}

interface PriceLookup {
  getMidYesAt(conditionId: string, ts: Date): number | null;
}

/**
 * Process trades for a single wallet and compute per-trade PnL
 */
export function computeTradeMetrics(
  trades: RawTrade[],
  resolutions: Map<string, Resolution>,
  priceLookup: PriceLookup
): TradeWithPnL[] {
  // Sort by time
  const sorted = [...trades].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // FIFO inventory per condition/side
  const inventory = new Map<string, FIFOLot[]>();
  const results: TradeWithPnL[] = [];

  for (const trade of sorted) {
    const key = `${trade.condition_id}|${trade.side}`;
    const resolution = resolutions.get(trade.condition_id);
    const priceSide = toSideSpace(trade.side, trade.price_yes);

    let lots = inventory.get(key) || [];

    if (trade.action === 'BUY') {
      // Add to inventory
      lots.push({
        qty: trade.qty,
        cost_per_share: trade.notional_usd / trade.qty,
        ts: trade.ts,
      });
      inventory.set(key, lots);

      // BUY trade: realized when position resolves
      const outcomeSide = resolution
        ? outcomeToSideSpace(trade.side, resolution.outcome_yes)
        : null;

      let realizedPnl: number | null = null;
      let realizedRoi: number | null = null;

      if (resolution && resolution.resolved_at <= new Date()) {
        // Position has resolved
        const settlementValue = trade.qty * (outcomeSide === 1 ? 1 : 0);
        realizedPnl = settlementValue - trade.notional_usd - trade.fee_usd;
        realizedRoi = trade.notional_usd > 0
          ? realizedPnl / trade.notional_usd
          : 0;
      }

      // CLV
      const clv = computeCLV(trade, resolution, priceLookup);

      results.push({
        trade_id: trade.trade_id,
        ts: trade.ts,
        wallet: trade.wallet,
        condition_id: trade.condition_id,
        side: trade.side,
        action: 'BUY',
        qty: trade.qty,
        price_side: priceSide,
        notional_usd: trade.notional_usd,
        fee_usd: trade.fee_usd,
        cost_basis_usd: trade.notional_usd,
        realized_pnl_usd: realizedPnl,
        realized_roi: realizedRoi,
        clv_1h: clv.clv_1h,
        clv_4h: clv.clv_4h,
        clv_24h: clv.clv_24h,
        clv_72h: clv.clv_72h,
        outcome_side: outcomeSide,
        is_resolved: resolution ? resolution.resolved_at <= new Date() : false,
        category: trade.category || '',
        event_id: trade.event_id || '',
      });
    } else {
      // SELL: Match against FIFO lots
      let remainingQty = trade.qty;
      let totalCostBasis = 0;

      while (remainingQty > 0 && lots.length > 0) {
        const lot = lots[0];
        const matchQty = Math.min(remainingQty, lot.qty);
        totalCostBasis += matchQty * lot.cost_per_share;
        lot.qty -= matchQty;
        remainingQty -= matchQty;

        if (lot.qty <= 0) {
          lots.shift();
        }
      }

      inventory.set(key, lots);

      const proceeds = trade.notional_usd - trade.fee_usd;
      const realizedPnl = proceeds - totalCostBasis;
      const realizedRoi = totalCostBasis > 0 ? realizedPnl / totalCostBasis : 0;

      results.push({
        trade_id: trade.trade_id,
        ts: trade.ts,
        wallet: trade.wallet,
        condition_id: trade.condition_id,
        side: trade.side,
        action: 'SELL',
        qty: trade.qty,
        price_side: priceSide,
        notional_usd: trade.notional_usd,
        fee_usd: trade.fee_usd,
        cost_basis_usd: totalCostBasis,
        realized_pnl_usd: realizedPnl,
        realized_roi: realizedRoi,
        clv_1h: null, // CLV less relevant for sells
        clv_4h: null,
        clv_24h: null,
        clv_72h: null,
        outcome_side: null,
        is_resolved: true, // Sell = realized
        category: trade.category || '',
        event_id: trade.event_id || '',
      });
    }
  }

  return results;
}

function computeCLV(
  trade: RawTrade,
  resolution: Resolution | undefined,
  priceLookup: PriceLookup
): { clv_1h: number | null; clv_4h: number | null; clv_24h: number | null; clv_72h: number | null } {
  if (!resolution) {
    return { clv_1h: null, clv_4h: null, clv_24h: null, clv_72h: null };
  }

  const entryPriceSide = toSideSpace(trade.side, trade.price_yes);
  const resolveTime = resolution.resolved_at.getTime();

  const getAnchor = (hoursBeforeResolve: number): number | null => {
    const anchorTime = new Date(resolveTime - hoursBeforeResolve * 3600 * 1000);
    if (anchorTime < trade.ts) return null; // Anchor before trade doesn't make sense
    const midYes = priceLookup.getMidYesAt(trade.condition_id, anchorTime);
    if (midYes === null) return null;
    return toSideSpace(trade.side, midYes) - entryPriceSide;
  };

  return {
    clv_1h: getAnchor(1),
    clv_4h: getAnchor(4),
    clv_24h: getAnchor(24),
    clv_72h: getAnchor(72),
  };
}

/**
 * Aggregate trade-level metrics to wallet-level summary
 */
export function aggregateWalletMetrics(trades: TradeWithPnL[]): WalletTradeMetrics {
  if (!trades.length) {
    return emptyWalletMetrics();
  }

  const resolvedTrades = trades.filter(t => t.is_resolved && t.realized_pnl_usd !== null);
  const buyTrades = trades.filter(t => t.action === 'BUY');
  const sellTrades = trades.filter(t => t.action === 'SELL');

  const totalPnl = resolvedTrades.reduce((sum, t) => sum + (t.realized_pnl_usd || 0), 0);
  const totalVolume = trades.reduce((sum, t) => sum + t.notional_usd, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.fee_usd, 0);

  const rois = resolvedTrades
    .map(t => t.realized_roi)
    .filter((r): r is number => r !== null);

  const wins = rois.filter(r => r > 0);
  const losses = rois.filter(r => r <= 0);

  const clv24hValues = trades
    .map(t => t.clv_24h)
    .filter((c): c is number => c !== null);

  return {
    total_trades: trades.length,
    buy_trades: buyTrades.length,
    sell_trades: sellTrades.length,
    resolved_trades: resolvedTrades.length,
    total_volume_usd: totalVolume,
    total_fees_usd: totalFees,
    total_pnl_usd: totalPnl,
    avg_trade_pnl_usd: resolvedTrades.length > 0 ? totalPnl / resolvedTrades.length : 0,
    win_rate: rois.length > 0 ? wins.length / rois.length : 0,
    avg_win_roi: wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
    avg_loss_roi: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    avg_roi: rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : 0,
    median_roi: rois.length > 0 ? sortedMedian(rois) : 0,
    roi_p05: rois.length > 0 ? sortedPercentile(rois, 5) : 0,
    roi_p95: rois.length > 0 ? sortedPercentile(rois, 95) : 0,
    avg_clv_24h: clv24hValues.length > 0 ? clv24hValues.reduce((a, b) => a + b, 0) / clv24hValues.length : 0,
    clv_win_rate: clv24hValues.length > 0 ? clv24hValues.filter(c => c > 0).length / clv24hValues.length : 0,
    unique_markets: new Set(trades.map(t => t.condition_id)).size,
    unique_categories: new Set(trades.map(t => t.category).filter(c => c)).size,
  };
}

export interface WalletTradeMetrics {
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  resolved_trades: number;
  total_volume_usd: number;
  total_fees_usd: number;
  total_pnl_usd: number;
  avg_trade_pnl_usd: number;
  win_rate: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  avg_roi: number;
  median_roi: number;
  roi_p05: number;
  roi_p95: number;
  avg_clv_24h: number;
  clv_win_rate: number;
  unique_markets: number;
  unique_categories: number;
}

function emptyWalletMetrics(): WalletTradeMetrics {
  return {
    total_trades: 0,
    buy_trades: 0,
    sell_trades: 0,
    resolved_trades: 0,
    total_volume_usd: 0,
    total_fees_usd: 0,
    total_pnl_usd: 0,
    avg_trade_pnl_usd: 0,
    win_rate: 0,
    avg_win_roi: 0,
    avg_loss_roi: 0,
    avg_roi: 0,
    median_roi: 0,
    roi_p05: 0,
    roi_p95: 0,
    avg_clv_24h: 0,
    clv_win_rate: 0,
    unique_markets: 0,
    unique_categories: 0,
  };
}

function sortedMedian(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sortedPercentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}
