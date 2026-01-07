/**
 * PnL Calculator - Properly handles real sells (not just complement filtering)
 *
 * Key insight: We can't just filter sells by price < 0.5
 * Real sells of cheap positions (like Bucharest at 0.1¢) would be excluded
 *
 * Instead: Track positions and allow sells that close actual positions
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

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

async function calcPnl() {
  console.log('PNL WITH REAL SELLS (NO PRICE FILTER)');
  console.log('Wallet:', wallet);
  console.log('='.repeat(90));
  console.log('Strategy: Keep ALL trades (buys and sells), dedup by (tx, side, token_id, amount)');
  console.log('          Position protection: sellAmount = min(position, requestedSellAmount)');
  console.log('='.repeat(90));

  // Get ALL trades - no price filter!
  // Dedup by (tx, side, token_id, token_amount) to handle backfill duplicates
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

  console.log('\nFound ' + trades.length + ' unique fills\n');

  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');
  console.log('Buys: ' + buys.length + ', Sells: ' + sells.length + '\n');

  const positions = new Map<string, Position>();

  console.log('TRADE-BY-TRADE:');
  console.log('-'.repeat(90));

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.usdc / trade.tokens;

    if (trade.side === 'buy') {
      const newPos = updateUserPositionWithBuy(pos, price, trade.tokens);
      console.log(
        'BUY  ' + trade.tokens.toFixed(2).padStart(10) + ' @ $' + price.toFixed(4) + ' | ' +
        'Pos: ' + newPos.amount.toFixed(2) + ' @ avg $' + newPos.avgPrice.toFixed(4)
      );
      positions.set(key, newPos);
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(pos.amount, trade.tokens);

      if (adjustedAmount < 0.01) {
        // No position to sell - this is a complement trade (mint-and-split)
        console.log(
          'SKIP ' + trade.tokens.toFixed(2).padStart(10) + ' @ $' + price.toFixed(4) + ' | ' +
          'No position (complement trade)'
        );
        continue;
      }

      const newPos = updateUserPositionWithSell(pos, price, trade.tokens);
      const deltaPnL = newPos.realizedPnl - pos.realizedPnl;
      console.log(
        'SELL ' + adjustedAmount.toFixed(2).padStart(10) + ' @ $' + price.toFixed(4) + ' | ' +
        'Was: $' + pos.avgPrice.toFixed(4) + ' | PnL: $' + deltaPnL.toFixed(2)
      );
      positions.set(key, newPos);
    }
  }

  // Calculate trading PnL
  let tradingPnl = 0;
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  console.log('\n' + '-'.repeat(90));
  console.log('TRADING PNL (from sells): $' + tradingPnl.toFixed(2));

  // Resolution PnL - only for positions still held
  console.log('\n' + '-'.repeat(90));
  console.log('RESOLUTION PNL (positions held to resolution):');

  let resolutionPnl = 0;
  let unresolvedCount = 0;
  let heldPositions = 0;

  for (const [tokenId, pos] of positions) {
    if (pos.amount > 0.01) {
      heldPositions++;
      const resolution = await getTokenResolution(tokenId);

      if (resolution === null) {
        console.log('  ?? Token ' + tokenId.slice(0, 16) + '... not in mapping');
      } else if (!resolution.resolved) {
        unresolvedCount++;
      } else if (resolution.payout > 0) {
        const pnl = (1.0 - pos.avgPrice) * pos.amount;
        resolutionPnl += pnl;
        console.log('  WON: ' + pos.amount.toFixed(2) + ' shares | cost $' + pos.avgPrice.toFixed(4) + ' | PnL: +$' + pnl.toFixed(2));
      } else {
        const pnl = -pos.avgPrice * pos.amount;
        resolutionPnl += pnl;
        console.log('  LOST: ' + pos.amount.toFixed(2) + ' shares | cost $' + pos.avgPrice.toFixed(4) + ' | PnL: $' + pnl.toFixed(2));
      }
    }
  }

  console.log('\n  Held positions: ' + heldPositions);
  if (unresolvedCount > 0) {
    console.log('  (' + unresolvedCount + ' unresolved positions not included)');
  }

  const totalPnl = tradingPnl + resolutionPnl;

  console.log('\n' + '='.repeat(90));
  console.log('TRADING PNL:    $' + tradingPnl.toFixed(2));
  console.log('RESOLUTION PNL: $' + resolutionPnl.toFixed(2));
  console.log('TOTAL PNL:      $' + totalPnl.toFixed(2));
  console.log('');
  console.log('UI SHOWS:       $123.23');
  console.log('GAP:            $' + (totalPnl - 123.23).toFixed(2));
  console.log('='.repeat(90));
}

calcPnl();
