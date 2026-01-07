/**
 * PnL Calculator - No Price Filter Version
 * Testing if the formula works for taker-only wallets without the price > 0.5 filter
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

interface Trade {
  event_id: string;
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

async function calcPnl() {
  console.log('PNL CALCULATION - NO PRICE FILTER');
  console.log('Wallet:', wallet);
  console.log('='.repeat(90));

  // NO price > 0.5 filter - get ALL trades deduped by (tx, side, usdc, tokens)
  const q = `
    SELECT
      any(event_id) as event_id,
      side,
      any(usdc_amount / 1e6) as usdc,
      any(token_amount / 1e6) as tokens,
      any(token_id) as token_id,
      min(trade_time) as trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
    GROUP BY transaction_hash, side, usdc_amount, token_amount
    ORDER BY trade_time, event_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const trades = (await r.json()) as Trade[];

  console.log(`Found ${trades.length} unique trades (no price filter)\n`);

  // Group trades by token_id
  const positions = new Map<string, Position>();
  let skippedSells = 0;

  console.log('TRADE-BY-TRADE (first 20 trades):');
  console.log('-'.repeat(90));

  let tradeCount = 0;
  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const suffix = trade.event_id?.slice(-4) || '';

    if (trade.side === 'buy') {
      const buyPrice = trade.usdc / trade.tokens;
      const newPos = updateUserPositionWithBuy(pos, buyPrice, trade.tokens);

      if (tradeCount < 20) {
        console.log(
          `[${suffix}] BUY  ${trade.tokens.toFixed(4)} @ $${buyPrice.toFixed(4)} | ` +
            `Pos: ${newPos.amount.toFixed(4)} @ avg $${newPos.avgPrice.toFixed(4)}`
        );
      }
      positions.set(key, newPos);
    } else if (trade.side === 'sell') {
      const sellPrice = trade.usdc / trade.tokens;
      const adjustedAmount = Math.min(pos.amount, trade.tokens);

      if (adjustedAmount < trade.tokens * 0.01) {
        if (tradeCount < 20) {
          console.log(
            `[${suffix}] SKIP ${trade.tokens.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
              `Insufficient pos (${pos.amount.toFixed(4)} held)`
          );
        }
        skippedSells++;
        tradeCount++;
        continue;
      }

      const newPos = updateUserPositionWithSell(pos, sellPrice, trade.tokens);
      const deltaPnL = newPos.realizedPnl - pos.realizedPnl;

      if (tradeCount < 20) {
        console.log(
          `[${suffix}] SELL ${adjustedAmount.toFixed(4)} @ $${sellPrice.toFixed(4)} | ` +
            `Avg: $${pos.avgPrice.toFixed(4)} | PnL: $${deltaPnL.toFixed(4)}`
        );
      }
      positions.set(key, newPos);
    }
    tradeCount++;
  }

  if (tradeCount > 20) {
    console.log(`... and ${tradeCount - 20} more trades`);
  }

  // Calculate totals
  let tradingPnl = 0;
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  console.log('\n' + '-'.repeat(90));
  console.log(`TRADING PNL: $${tradingPnl.toFixed(4)}`);
  console.log(`Sells skipped (insufficient position): ${skippedSells}`);

  // Check resolutions
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

calcPnl();
