/**
 * Subgraph-Style PnL Engine WITH Unrealized PnL
 * Includes mark-to-market for active positions using Gamma API prices
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

interface TokenInfo {
  condition_id: string;
  outcome_index: number;
  resolved: boolean;
  payout: number;
  current_price: number | null;
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

async function fetchGammaPrices(conditionIds: string[]): Promise<Map<string, { yes: number; no: number }>> {
  const prices = new Map<string, { yes: number; no: number }>();

  // Batch fetch from Gamma API using condition_ids
  const batchSize = 50;
  for (let i = 0; i < conditionIds.length; i += batchSize) {
    const batch = conditionIds.slice(i, i + batchSize);

    for (const conditionId of batch) {
      try {
        // Try fetching by condition_id
        const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
        const response = await fetch(url);
        if (response.ok) {
          const markets = await response.json();
          if (markets && markets.length > 0) {
            const market = markets[0];
            // Get outcome prices
            if (market.outcomePrices) {
              const outcomePrices = JSON.parse(market.outcomePrices);
              prices.set(conditionId, {
                yes: parseFloat(outcomePrices[0] || '0'),
                no: parseFloat(outcomePrices[1] || '0'),
              });
            } else if (market.tokens && market.tokens.length >= 2) {
              prices.set(conditionId, {
                yes: parseFloat(market.tokens[0]?.price || '0'),
                no: parseFloat(market.tokens[1]?.price || '0'),
              });
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }
  }

  return prices;
}

async function calculatePnl(wallet: string) {
  console.log('Wallet:', wallet);

  // Load trades with dedup
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
  const heldPositions = Array.from(positions.entries())
    .filter(([_, pos]) => pos.amount > 0.01);

  console.log('  Positions held:', heldPositions.length);

  if (heldPositions.length === 0) {
    console.log('');
    console.log('  Trading PnL:     $' + tradingPnl.toFixed(2));
    console.log('  Resolution PnL:  $0.00');
    console.log('  Unrealized PnL:  $0.00');
    console.log('  TOTAL PNL:       $' + tradingPnl.toFixed(2));
    return;
  }

  // Load resolutions via JOIN
  const resQ = `
    SELECT
      m.token_id_dec,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE m.token_id_dec IN (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
  `;

  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resRows = (await resR.json()) as any[];

  // Build token info map
  const tokenInfo = new Map<string, TokenInfo>();
  for (const r of resRows) {
    if (r.payout_numerators) {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      const payout = payouts[r.outcome_index] > 0 ? 1.0 : 0.0;
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: true,
        payout,
        current_price: null,
      });
    } else {
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: false,
        payout: 0,
        current_price: null,
      });
    }
  }

  // Get unresolved condition IDs for price fetching
  const unresolvedConditionIds = new Set<string>();
  for (const [tokenId, _] of heldPositions) {
    const info = tokenInfo.get(tokenId);
    if (info && !info.resolved) {
      unresolvedConditionIds.add(info.condition_id);
    }
  }

  console.log('  Fetching prices for', unresolvedConditionIds.size, 'unresolved conditions...');

  // Fetch current prices from Gamma API
  const conditionPrices = await fetchGammaPrices(Array.from(unresolvedConditionIds));
  console.log('  Got prices for', conditionPrices.size, 'conditions');

  // Calculate PnL
  let resolutionPnl = 0;
  let unrealizedPnl = 0;
  let positionsWon = 0;
  let positionsLost = 0;
  let unresolvedCount = 0;
  let unresolvedWithPrice = 0;
  let unmappedCount = 0;

  for (const [tokenId, pos] of heldPositions) {
    const info = tokenInfo.get(tokenId);

    if (!info) {
      unmappedCount++;
      continue;
    }

    if (info.resolved) {
      // Resolved position - realized PnL
      const pnl = (info.payout - pos.avgPrice) * pos.amount;
      resolutionPnl += pnl;

      if (info.payout > 0) {
        positionsWon++;
      } else {
        positionsLost++;
      }
    } else {
      // Unresolved position - check for current price
      unresolvedCount++;
      const prices = conditionPrices.get(info.condition_id);

      if (prices) {
        unresolvedWithPrice++;
        // outcome_index 0 = Yes, outcome_index 1 = No
        const currentPrice = info.outcome_index === 0 ? prices.yes : prices.no;
        const pnl = (currentPrice - pos.avgPrice) * pos.amount;
        unrealizedPnl += pnl;
      }
      // If no price, unrealized PnL for this position is 0 (conservative)
    }
  }

  const totalPnl = tradingPnl + resolutionPnl + unrealizedPnl;

  console.log('  Buys:', buyCount, '| Sells:', sellCount, '| Complement skipped:', complementSkipped);
  console.log('  Won:', positionsWon, '| Lost:', positionsLost);
  console.log('  Unresolved:', unresolvedCount, '(priced:', unresolvedWithPrice + ')');
  console.log('  Unmapped:', unmappedCount);
  console.log('');
  console.log('  Trading PnL:     $' + tradingPnl.toFixed(2));
  console.log('  Resolution PnL:  $' + resolutionPnl.toFixed(2));
  console.log('  Unrealized PnL:  $' + unrealizedPnl.toFixed(2));
  console.log('  ─────────────────────');
  console.log('  TOTAL PNL:       $' + totalPnl.toFixed(2));
}

async function main() {
  const wallets = process.argv.slice(2);

  if (wallets.length === 0) {
    console.log('Usage: npx tsx scripts/pnl-subgraph-with-unrealized.ts <wallet1> [wallet2] ...');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('SUBGRAPH-STYLE PNL ENGINE (With Unrealized)');
  console.log('='.repeat(70));
  console.log('Includes mark-to-market for active positions via Gamma API');
  console.log('');

  for (const wallet of wallets) {
    console.log('');
    console.log('-'.repeat(70));
    await calculatePnl(wallet);
  }

  console.log('');
  console.log('='.repeat(70));
}

main();
