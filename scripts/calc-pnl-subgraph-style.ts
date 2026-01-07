/**
 * PnL Calculator - Polymarket Subgraph Style
 *
 * This implements the EXACT logic from Polymarket's subgraph:
 * - updateUserPositionWithBuy: weighted average cost tracking
 * - updateUserPositionWithSell: position-protected PnL calculation
 *
 * Key insight: The subgraph uses adjustedAmount = min(position, sellAmount)
 * This naturally handles duplicate/phantom sells by only processing
 * what the wallet actually has.
 *
 * This works for ANY wallet - maker only, taker only, or mixed.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0xf918977ef9d3f101385eda508621d5f835fa9052';

interface Trade {
  event_id: string;
  side: string;
  usdc: number;
  tokens: number;
  token_id: string;
  trade_time: string;
}

interface Position {
  amount: number;      // tokens held
  avgPrice: number;    // weighted average cost per token
  realizedPnl: number; // accumulated realized PnL for this position
}

// Polymarket subgraph: updateUserPositionWithBuy
function updateUserPositionWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;

  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  const newAvgPrice = numerator / denominator;

  return {
    amount: pos.amount + amount,
    avgPrice: newAvgPrice,
    realizedPnl: pos.realizedPnl,
  };
}

// Polymarket subgraph: updateUserPositionWithSell
function updateUserPositionWithSell(pos: Position, price: number, amount: number): Position {
  // KEY: adjustedAmount protects against selling more than owned
  const adjustedAmount = Math.min(pos.amount, amount);

  if (adjustedAmount <= 0) {
    return pos; // Nothing to sell
  }

  const deltaPnL = adjustedAmount * (price - pos.avgPrice);

  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice, // avgPrice doesn't change on sell
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

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
    SELECT payout_numerators, payout_denominator
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

async function calcPnlSubgraphStyle() {
  console.log('PNL CALCULATION - POLYMARKET SUBGRAPH STYLE');
  console.log('Wallet:', wallet);
  console.log('='.repeat(90));
  console.log('Using position protection: adjustedAmount = min(position, sellAmount)');
  console.log('This handles duplicates/phantoms automatically.\n');

  // Get ALL trades (both maker and taker), deduped by (tx, side, amount)
  // We include both -m and -t, let position protection handle duplicates
  const q = `
    SELECT
      any(event_id) as event_id,
      side,
      any(usdc_amount / 1e6) as usdc,
      any(token_amount / 1e6) as tokens,
      any(token_id) as token_id,
      any(trade_time) as trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
      AND (usdc_amount / 1e6) / (token_amount / 1e6) > 0.5
    GROUP BY transaction_hash, side, usdc_amount, token_amount
    ORDER BY trade_time, event_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const trades = (await r.json()) as Trade[];

  console.log(`Found ${trades.length} unique trades (deduped by tx/side/amount)\n`);

  // Track positions per token_id
  const positions = new Map<string, Position>();
  let skippedSells = 0;

  console.log('TRADE-BY-TRADE CALCULATION:');
  console.log('-'.repeat(90));

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const suffix = trade.event_id?.slice(-2) || '';

    if (trade.side === 'buy') {
      const buyPrice = trade.usdc / trade.tokens;
      const newPos = updateUserPositionWithBuy(pos, buyPrice, trade.tokens);

      console.log(
        `[${suffix}] BUY  ${trade.tokens.toFixed(4)} @ $${buyPrice.toFixed(4)} | ` +
          `Pos: ${newPos.amount.toFixed(4)} @ avg $${newPos.avgPrice.toFixed(4)}`
      );

      positions.set(key, newPos);
    } else if (trade.side === 'sell') {
      const sellPrice = trade.usdc / trade.tokens;
      const adjustedAmount = Math.min(pos.amount, trade.tokens);

      if (adjustedAmount < trade.tokens * 0.01) {
        console.log(
          `[${suffix}] SKIP ${trade.tokens.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
            `Insufficient position (${pos.amount.toFixed(4)} held)`
        );
        skippedSells++;
        continue;
      }

      const newPos = updateUserPositionWithSell(pos, sellPrice, trade.tokens);
      const deltaPnL = newPos.realizedPnl - pos.realizedPnl;

      console.log(
        `[${suffix}] SELL ${adjustedAmount.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
          `Avg cost: $${pos.avgPrice.toFixed(4)} | PnL: $${deltaPnL.toFixed(4)}`
      );

      positions.set(key, newPos);
    }
  }

  // Calculate total trading PnL
  let tradingPnl = 0;
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  console.log('\n' + '-'.repeat(90));
  console.log(`TRADING PNL: $${tradingPnl.toFixed(4)}`);
  console.log(`Sells skipped (insufficient position): ${skippedSells}`);

  // Now check resolutions for remaining positions
  console.log('\n' + '-'.repeat(90));
  console.log('RESOLUTION PNL (held to resolution):');

  let resolutionPnl = 0;

  for (const [tokenId, pos] of positions) {
    if (pos.amount > 0.001) {
      const resolution = await getTokenResolution(tokenId);

      if (resolution === null) {
        console.log(`  ?? Token ${tokenId.slice(0, 20)}... not in mapping`);
      } else if (!resolution.resolved) {
        console.log(`  ?? UNRESOLVED: ${pos.amount.toFixed(4)} @ avg $${pos.avgPrice.toFixed(4)}`);
      } else if (resolution.payout > 0) {
        const pnl = (1.0 - pos.avgPrice) * pos.amount;
        resolutionPnl += pnl;
        console.log(`  ✓ WON: ${pos.amount.toFixed(4)} @ $1.00 | cost $${pos.avgPrice.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);
      } else {
        const pnl = (0.0 - pos.avgPrice) * pos.amount;
        resolutionPnl += pnl;
        console.log(`  ✗ LOST: ${pos.amount.toFixed(4)} @ $0.00 | cost $${pos.avgPrice.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);
      }
    }
  }

  const totalPnl = tradingPnl + resolutionPnl;

  console.log('\n' + '='.repeat(90));
  console.log(`TRADING PNL:    $${tradingPnl.toFixed(2)}`);
  console.log(`RESOLUTION PNL: $${resolutionPnl.toFixed(2)}`);
  console.log(`TOTAL PNL:      $${totalPnl.toFixed(2)}`);
  console.log('='.repeat(90));
}

calcPnlSubgraphStyle();
