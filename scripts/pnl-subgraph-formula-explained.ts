/**
 * ============================================================================
 * PNL SUBGRAPH-STYLE ENGINE (Position Tracker)
 * ============================================================================
 *
 * This is NOT v19s. This is a NEW approach based on Polymarket's subgraph code.
 *
 * KEY DIFFERENCES FROM V19s:
 *   - V19s: Uses pm_unified_ledger_v6 with cash_flow aggregation
 *   - This: Uses pm_trader_events_v2 with trade-by-trade position tracking
 *
 * FORMULA (Polymarket Subgraph Style):
 *
 * 1. BUY: Weighted average cost basis
 *    newAvgPrice = (oldAvgPrice * oldAmount + buyPrice * buyAmount) / (oldAmount + buyAmount)
 *    newAmount = oldAmount + buyAmount
 *
 * 2. SELL: Realize profit/loss against cost basis
 *    adjustedAmount = min(position, sellAmount)  // POSITION PROTECTION
 *    realizedPnL += adjustedAmount * (sellPrice - avgPrice)
 *    newAmount = oldAmount - adjustedAmount
 *
 * 3. RESOLUTION: Settle remaining position at $1 or $0
 *    resolutionPnL = finalAmount * (resolutionPrice - avgPrice)
 *    where resolutionPrice = 1.0 (winner) or 0.0 (loser)
 *
 * COMPLEMENT TRADE HANDLING:
 *   - Polymarket "mint-and-split" creates phantom sells
 *   - Example: BUY YES at $0.02 → also records SELL NO at $0.98
 *   - Solution: Position protection (min(position, sellAmount))
 *   - If position=0, adjustedAmount=0, sell is skipped (complement trade)
 *
 * DATA DEDUPLICATION:
 *   - pm_trader_events_v2 has backfill duplicates
 *   - GROUP BY (transaction_hash, side, token_id, token_amount)
 *
 * ============================================================================
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Trade {
  side: string;
  usdc: number;
  tokens: number;
  token_id: string;
  trade_time: string;
}

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

interface PnlResult {
  wallet: string;
  tradingPnl: number;
  resolutionPnl: number;
  totalPnl: number;
  buyCount: number;
  sellCount: number;
  complementSkipped: number;
  positionsHeld: number;
  positionsWon: number;
  positionsLost: number;
  unresolvedCount: number;
}

// -----------------------------------------------------------------------------
// Core Formula Functions (from Polymarket subgraph)
// -----------------------------------------------------------------------------

/**
 * BUY: Update position with weighted average cost
 */
function updateUserPositionWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
    realizedPnl: pos.realizedPnl,
  };
}

/**
 * SELL: Realize PnL against cost basis (with position protection)
 */
function updateUserPositionWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount); // POSITION PROTECTION
  if (adjustedAmount <= 0) return pos;
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

// -----------------------------------------------------------------------------
// Resolution Lookup
// -----------------------------------------------------------------------------

async function getTokenResolution(tokenId: string): Promise<{ resolved: boolean; payout: number } | null> {
  const mapQ = `
    SELECT condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec = '${tokenId}'
  `;

  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mapRows = (await mapR.json()) as any[];

  if (mapRows.length === 0) return null;

  const m = mapRows[0];

  const resQ = `
    SELECT payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id = '${m.condition_id}'
  `;

  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resRows = (await resR.json()) as any[];

  if (resRows.length === 0) {
    return { resolved: false, payout: 0 };
  }

  const res = resRows[0];
  const payouts = JSON.parse(res.payout_numerators.replace(/'/g, '"'));
  const payout = payouts[m.outcome_index] > 0 ? 1.0 : 0.0;

  return { resolved: true, payout };
}

// -----------------------------------------------------------------------------
// Main PnL Calculation
// -----------------------------------------------------------------------------

async function calculatePnlSubgraphStyle(wallet: string): Promise<PnlResult> {
  // Load trades with deduplication
  const q = `
    SELECT
      side,
      usdc / 1e6 AS usdc,
      tokens / 1e6 AS tokens,
      token_id,
      trade_time
    FROM (
      SELECT
        side,
        token_id,
        any(usdc_amount) AS usdc,
        token_amount AS tokens,
        max(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY transaction_hash, side, token_id, token_amount
    )
    ORDER BY trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const trades = (await r.json()) as Trade[];

  const positions = new Map<string, Position>();
  let complementSkipped = 0;
  let buyCount = 0;
  let sellCount = 0;

  // Process trades in chronological order
  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.usdc / trade.tokens;

    if (trade.side === 'buy') {
      buyCount++;
      positions.set(key, updateUserPositionWithBuy(pos, price, trade.tokens));
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(pos.amount, trade.tokens);
      if (adjustedAmount < 0.01) {
        complementSkipped++;
        continue; // No position = complement trade
      }
      sellCount++;
      positions.set(key, updateUserPositionWithSell(pos, price, trade.tokens));
    }
  }

  // Calculate trading PnL
  let tradingPnl = 0;
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  // Calculate resolution PnL
  let resolutionPnl = 0;
  let positionsHeld = 0;
  let positionsWon = 0;
  let positionsLost = 0;
  let unresolvedCount = 0;

  for (const [tokenId, pos] of positions) {
    if (pos.amount > 0.01) {
      positionsHeld++;
      const resolution = await getTokenResolution(tokenId);

      if (resolution === null) {
        // Token not in mapping - treat as unresolved
        unresolvedCount++;
      } else if (!resolution.resolved) {
        unresolvedCount++;
      } else if (resolution.payout > 0) {
        // WINNER: payout at $1.00
        positionsWon++;
        resolutionPnl += (1.0 - pos.avgPrice) * pos.amount;
      } else {
        // LOSER: payout at $0.00
        positionsLost++;
        resolutionPnl += (0.0 - pos.avgPrice) * pos.amount;
      }
    }
  }

  return {
    wallet,
    tradingPnl,
    resolutionPnl,
    totalPnl: tradingPnl + resolutionPnl,
    buyCount,
    sellCount,
    complementSkipped,
    positionsHeld,
    positionsWon,
    positionsLost,
    unresolvedCount,
  };
}

// -----------------------------------------------------------------------------
// Run on wallets
// -----------------------------------------------------------------------------

async function main() {
  const wallets = process.argv.slice(2);

  if (wallets.length === 0) {
    console.log('Usage: npx tsx scripts/pnl-subgraph-formula-explained.ts <wallet1> [wallet2] ...');
    process.exit(1);
  }

  console.log('='.repeat(90));
  console.log('PNL SUBGRAPH-STYLE ENGINE (Position Tracker)');
  console.log('='.repeat(90));
  console.log('');
  console.log('FORMULA:');
  console.log('  BUY:  avgPrice = (oldAvg * oldAmt + buyPrice * buyAmt) / (oldAmt + buyAmt)');
  console.log('  SELL: realizedPnL += min(position, sellAmt) * (sellPrice - avgPrice)');
  console.log('  RESOLUTION: pnl = finalShares * (resolutionPrice - avgPrice)');
  console.log('');
  console.log('COMPLEMENT HANDLING: Skip sells where position = 0 (phantom trades from mint-and-split)');
  console.log('DEDUP: GROUP BY (tx_hash, side, token_id, token_amount)');
  console.log('='.repeat(90));

  for (const wallet of wallets) {
    console.log('');
    console.log('-'.repeat(90));
    console.log('WALLET:', wallet);
    console.log('-'.repeat(90));

    const result = await calculatePnlSubgraphStyle(wallet);

    console.log('');
    console.log('TRADE STATS:');
    console.log('  Buys processed:       ', result.buyCount);
    console.log('  Sells processed:      ', result.sellCount);
    console.log('  Complement skipped:   ', result.complementSkipped);
    console.log('');
    console.log('POSITION STATS:');
    console.log('  Positions held:       ', result.positionsHeld);
    console.log('  Positions won:        ', result.positionsWon);
    console.log('  Positions lost:       ', result.positionsLost);
    console.log('  Unresolved:           ', result.unresolvedCount);
    console.log('');
    console.log('PNL BREAKDOWN:');
    console.log('  Trading PnL:          $' + result.tradingPnl.toFixed(2));
    console.log('  Resolution PnL:       $' + result.resolutionPnl.toFixed(2));
    console.log('  ─────────────────────────');
    console.log('  TOTAL PNL:            $' + result.totalPnl.toFixed(2));
  }

  console.log('');
  console.log('='.repeat(90));
}

main();
