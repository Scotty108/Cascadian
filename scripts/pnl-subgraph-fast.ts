/**
 * Fast Subgraph-Style PnL Engine
 * Optimized with batch resolution lookups
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

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
    avgPrice: denominator > 0 ? numerator / denominator : 0,
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

async function calculatePnlFast(wallet: string) {
  console.log('Wallet:', wallet);

  // Load trades
  const tradesQ = `
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

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Trade[];

  console.log('  Trades loaded:', trades.length);

  // Process trades
  const positions = new Map<string, Position>();
  let complementSkipped = 0;
  let buyCount = 0;
  let sellCount = 0;

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
        continue;
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

  // Get held positions (amount > 0)
  const heldTokenIds = Array.from(positions.entries())
    .filter(([_, pos]) => pos.amount > 0.01)
    .map(([tokenId, _]) => tokenId);

  console.log('  Positions held:', heldTokenIds.length);

  if (heldTokenIds.length === 0) {
    console.log('');
    console.log('  Trading PnL:     $' + tradingPnl.toFixed(2));
    console.log('  Resolution PnL:  $0.00');
    console.log('  TOTAL PNL:       $' + tradingPnl.toFixed(2));
    return;
  }

  // Batch load token mappings
  const tokenList = heldTokenIds.map(t => "'" + t + "'").join(',');
  const mapQ = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec IN (${tokenList})
  `;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, { condition_id: m.condition_id, outcome_index: m.outcome_index });
  }

  // Batch load resolutions
  const conditionIds = [...new Set(mappings.map(m => m.condition_id))];
  const conditionList = conditionIds.map(c => "'" + c + "'").join(',');

  let resolutions = new Map<string, number[]>();
  if (conditionIds.length > 0) {
    const resQ = `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionList})
    `;
    const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
    const resRows = (await resR.json()) as any[];

    for (const r of resRows) {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      resolutions.set(r.condition_id, payouts);
    }
  }

  // Calculate resolution PnL
  let resolutionPnl = 0;
  let positionsWon = 0;
  let positionsLost = 0;
  let unresolvedCount = 0;

  for (const tokenId of heldTokenIds) {
    const pos = positions.get(tokenId)!;
    const mapping = tokenToCondition.get(tokenId);

    if (!mapping) {
      unresolvedCount++;
      continue;
    }

    const payouts = resolutions.get(mapping.condition_id);
    if (!payouts) {
      unresolvedCount++;
      continue;
    }

    const payout = payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0;
    const pnl = (payout - pos.avgPrice) * pos.amount;
    resolutionPnl += pnl;

    if (payout > 0) {
      positionsWon++;
    } else {
      positionsLost++;
    }
  }

  const totalPnl = tradingPnl + resolutionPnl;

  console.log('  Buys:', buyCount, '| Sells:', sellCount, '| Complement skipped:', complementSkipped);
  console.log('  Won:', positionsWon, '| Lost:', positionsLost, '| Unresolved:', unresolvedCount);
  console.log('');
  console.log('  Trading PnL:     $' + tradingPnl.toFixed(2));
  console.log('  Resolution PnL:  $' + resolutionPnl.toFixed(2));
  console.log('  ─────────────────────');
  console.log('  TOTAL PNL:       $' + totalPnl.toFixed(2));
}

async function main() {
  const wallets = process.argv.slice(2);

  if (wallets.length === 0) {
    console.log('Usage: npx tsx scripts/pnl-subgraph-fast.ts <wallet1> [wallet2] ...');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('SUBGRAPH-STYLE PNL ENGINE (Fast Batch Mode)');
  console.log('='.repeat(70));

  for (const wallet of wallets) {
    console.log('');
    console.log('-'.repeat(70));
    await calculatePnlFast(wallet);
  }

  console.log('');
  console.log('='.repeat(70));
}

main();
