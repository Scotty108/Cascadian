/**
 * Universal PnL Calculator - Works for ALL wallet types
 *
 * Implements Polymarket subgraph logic correctly:
 * 1. Uses BOTH maker + taker events
 * 2. Dedupes backfill duplicates by event_id
 * 3. Collapses self-trades by fill_id (prefer taker for fee correctness)
 * 4. NO price filter - handles all trading patterns
 * 5. Position protection: adjustedAmount = min(position, sellAmount)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0xf918977ef9d3f101385eda508621d5f835fa9052';

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

// Polymarket subgraph: updateUserPositionWithBuy
function updateUserPositionWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: numerator / denominator,
    realizedPnl: pos.realizedPnl,
  };
}

// Polymarket subgraph: updateUserPositionWithSell
function updateUserPositionWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount);
  if (adjustedAmount <= 0) return pos;
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
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

async function calcPnlUniversal() {
  console.log('UNIVERSAL PNL CALCULATOR');
  console.log('Wallet:', wallet);
  console.log('='.repeat(90));
  console.log('Strategy: all buys + sells>0.5, tx dedup, fill collapse, position protection');
  console.log('='.repeat(90));

  // Strategy:
  // 1. Keep ALL buys (any price) - handles normal trading and arb buying
  // 2. Filter sells by price > 0.5 - excludes complement sells but keeps real sells
  // 3. Dedup by (tx_hash, side, usdc, tokens) to handle backfill duplicates
  // 4. Collapse by fill_id (strip -m/-t), prefer taker when same wallet is both maker & taker
  // 5. Apply position protection (adjustedAmount = min(position, sellAmount))
  const q = `
    WITH filtered_trades AS (
      SELECT
        event_id,
        replaceRegexpAll(event_id, '-[mt]$', '') AS fill_id,
        if(event_id LIKE '%-t', 1, 0) AS is_taker,
        side,
        token_id,
        usdc_amount,
        token_amount,
        trade_time,
        transaction_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND (
          side = 'buy'  -- Keep ALL buys (handles arb and normal trading)
          OR (side = 'sell' AND (usdc_amount / token_amount) > 0.5)  -- Filter complement sells
        )
    ),
    dedup_backfill AS (
      -- Dedup backfill duplicates by grouping same (tx, side, amounts)
      SELECT
        any(event_id) AS event_id,
        any(fill_id) AS fill_id,
        max(is_taker) AS is_taker,
        side,
        any(token_id) AS token_id,
        usdc_amount,
        token_amount,
        max(trade_time) AS trade_time
      FROM filtered_trades
      GROUP BY transaction_hash, side, usdc_amount, token_amount
    ),
    fills AS (
      -- Collapse by fill_id, preferring taker when wallet is both maker & taker
      SELECT
        fill_id,
        argMax(side, is_taker) AS side,
        argMax(token_id, is_taker) AS token_id,
        argMax(usdc_amount, is_taker) AS usdc_amount,
        argMax(token_amount, is_taker) AS token_amount,
        max(trade_time) AS trade_time
      FROM dedup_backfill
      GROUP BY fill_id
    )
    SELECT
      side,
      usdc_amount / 1e6 AS usdc,
      token_amount / 1e6 AS tokens,
      token_id,
      trade_time
    FROM fills
    ORDER BY trade_time, fill_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const trades = (await r.json()) as Trade[];

  console.log(`\nFound ${trades.length} unique fills\n`);

  // Count trade types
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');
  console.log(`Buys: ${buys.length}, Sells: ${sells.length}\n`);

  const positions = new Map<string, Position>();
  let skippedSells = 0;

  console.log('TRADE-BY-TRADE (first 30):');
  console.log('-'.repeat(90));

  let tradeCount = 0;
  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };

    if (trade.side === 'buy') {
      const buyPrice = trade.usdc / trade.tokens;
      const newPos = updateUserPositionWithBuy(pos, buyPrice, trade.tokens);

      if (tradeCount < 30) {
        console.log(
          `BUY  ${trade.tokens.toFixed(4)} @ $${buyPrice.toFixed(4)} | ` +
            `Pos: ${newPos.amount.toFixed(4)} @ avg $${newPos.avgPrice.toFixed(4)}`
        );
      }
      positions.set(key, newPos);
    } else if (trade.side === 'sell') {
      const sellPrice = trade.usdc / trade.tokens;
      const adjustedAmount = Math.min(pos.amount, trade.tokens);

      if (adjustedAmount < trade.tokens * 0.01) {
        if (tradeCount < 30) {
          console.log(
            `SKIP ${trade.tokens.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
              `Insufficient pos (${pos.amount.toFixed(4)} held)`
          );
        }
        skippedSells++;
        tradeCount++;
        continue;
      }

      const newPos = updateUserPositionWithSell(pos, sellPrice, trade.tokens);
      const deltaPnL = newPos.realizedPnl - pos.realizedPnl;

      if (tradeCount < 30) {
        console.log(
          `SELL ${adjustedAmount.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
            `Avg: $${pos.avgPrice.toFixed(4)} | PnL: $${deltaPnL.toFixed(4)}`
        );
      }
      positions.set(key, newPos);
    }
    tradeCount++;
  }

  if (tradeCount > 30) {
    console.log(`... and ${tradeCount - 30} more trades`);
  }

  // Calculate trading PnL
  let tradingPnl = 0;
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  console.log('\n' + '-'.repeat(90));
  console.log(`TRADING PNL: $${tradingPnl.toFixed(4)}`);
  console.log(`Sells skipped (insufficient position): ${skippedSells}`);

  // Resolution PnL
  console.log('\n' + '-'.repeat(90));
  console.log('RESOLUTION PNL:');

  let resolutionPnl = 0;
  let unresolvedCount = 0;

  for (const [tokenId, pos] of positions) {
    if (pos.amount > 0.001) {
      const resolution = await getTokenResolution(tokenId);

      if (resolution === null) {
        console.log(`  ?? Token ${tokenId.slice(0, 20)}... not in mapping`);
      } else if (!resolution.resolved) {
        unresolvedCount++;
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

  if (unresolvedCount > 0) {
    console.log(`  (${unresolvedCount} unresolved positions not included)`);
  }

  const totalPnl = tradingPnl + resolutionPnl;

  console.log('\n' + '='.repeat(90));
  console.log(`TRADING PNL:    $${tradingPnl.toFixed(2)}`);
  console.log(`RESOLUTION PNL: $${resolutionPnl.toFixed(2)}`);
  console.log(`TOTAL PNL:      $${totalPnl.toFixed(2)}`);
  console.log('='.repeat(90));
}

calcPnlUniversal();
