/**
 * Calculate exact unrealized PnL for xcnstrategy
 * - Positions at exactly 100% or 0% are treated as realized
 * - Everything else is unrealized
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

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

async function calculate() {
  console.log('='.repeat(70));
  console.log('EXACT UNREALIZED PNL CALCULATION');
  console.log('Positions at 100% or 0% = Realized, Everything else = Unrealized');
  console.log('='.repeat(70));
  console.log('');

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
  const trades = (await tradesR.json()) as any[];

  // Build positions
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.usdc / trade.tokens;

    if (trade.side === 'buy') {
      positions.set(key, updateUserPositionWithBuy(pos, price, trade.tokens));
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(pos.amount, trade.tokens);
      if (adjustedAmount >= 0.01) {
        positions.set(key, updateUserPositionWithSell(pos, price, trade.tokens));
      }
    }
  }

  // Get held positions
  const heldTokenIds = Array.from(positions.entries())
    .filter(([_, pos]) => pos.amount > 0.01)
    .map(([tokenId, _]) => tokenId);

  console.log('Held positions:', heldTokenIds.length);

  // Get token mappings
  const mapQ = `
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

  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mapRows = (await mapR.json()) as any[];

  // Build token info map
  const tokenInfo = new Map<string, { condition_id: string; outcome_index: number; resolved: boolean; payout: number }>();
  for (const r of mapRows) {
    if (r.payout_numerators) {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      const payout = payouts[r.outcome_index] > 0 ? 1.0 : 0.0;
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: true,
        payout,
      });
    } else {
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: false,
        payout: 0,
      });
    }
  }

  // Get unresolved condition_ids and fetch prices from Gamma API
  const unresolvedConditions = new Set<string>();
  for (const tokenId of heldTokenIds) {
    const info = tokenInfo.get(tokenId);
    if (info && !info.resolved) {
      unresolvedConditions.add(info.condition_id);
    }
  }

  console.log('Fetching prices for', unresolvedConditions.size, 'unresolved conditions...');

  // Fetch prices from Gamma API
  const conditionPrices = new Map<string, { yes: number; no: number }>();

  for (const cid of unresolvedConditions) {
    try {
      const url = `https://gamma-api.polymarket.com/markets?condition_id=${cid}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const markets = await resp.json();
        if (markets && markets.length > 0) {
          const m = markets[0];
          if (m.outcomePrices) {
            const prices = JSON.parse(m.outcomePrices);
            conditionPrices.set(cid, {
              yes: parseFloat(prices[0] || '0'),
              no: parseFloat(prices[1] || '0'),
            });
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  console.log('Got prices for', conditionPrices.size, 'conditions');
  console.log('');

  // Calculate PnL components
  let tradingPnl = 0;
  let dbResolvedPnl = 0;
  let exactZeroOrHundredPnl = 0;
  let trueUnrealizedPnl = 0;

  let dbResolvedCount = 0;
  let exactZeroCount = 0;
  let exactHundredCount = 0;
  let trueUnrealizedCount = 0;
  let noPriceCount = 0;
  let zombieCount = 0;

  const exactZeroOrHundredPositions: any[] = [];
  const trueUnrealizedPositions: any[] = [];

  // Trading PnL from sells
  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  // Resolution/Unrealized PnL
  for (const tokenId of heldTokenIds) {
    const pos = positions.get(tokenId)!;
    const info = tokenInfo.get(tokenId);

    if (!info) {
      continue;
    }

    if (info.resolved) {
      // DB has resolution - this is fully realized
      const pnl = (info.payout - pos.avgPrice) * pos.amount;
      dbResolvedPnl += pnl;
      dbResolvedCount++;
    } else {
      // Not in DB - check current price
      const prices = conditionPrices.get(info.condition_id);

      if (!prices || (prices.yes === 0 && prices.no === 0)) {
        // Zombie market - closed but no prices
        zombieCount++;
        continue;
      }

      const currentPrice = info.outcome_index === 0 ? prices.yes : prices.no;
      const pnl = (currentPrice - pos.avgPrice) * pos.amount;

      // Check if exactly 100% (1.0) or 0% (0.0)
      if (currentPrice === 1.0 || currentPrice === 0.0) {
        exactZeroOrHundredPnl += pnl;
        if (currentPrice === 1.0) exactHundredCount++;
        else exactZeroCount++;
        exactZeroOrHundredPositions.push({
          condition_id: info.condition_id.slice(0, 20),
          outcome_index: info.outcome_index,
          shares: pos.amount,
          avgPrice: pos.avgPrice,
          currentPrice,
          pnl,
        });
      } else {
        // True unrealized - price is between 0 and 1
        trueUnrealizedPnl += pnl;
        trueUnrealizedCount++;
        trueUnrealizedPositions.push({
          condition_id: info.condition_id.slice(0, 20),
          outcome_index: info.outcome_index,
          shares: pos.amount,
          avgPrice: pos.avgPrice,
          currentPrice,
          pnl,
        });
      }
    }
  }

  console.log('='.repeat(70));
  console.log('POSITION BREAKDOWN');
  console.log('='.repeat(70));
  console.log('DB Resolved positions:', dbResolvedCount);
  console.log('Positions at exactly 100%:', exactHundredCount);
  console.log('Positions at exactly 0%:', exactZeroCount);
  console.log('True unrealized (0 < price < 1):', trueUnrealizedCount);
  console.log('Zombie (closed, no price):', zombieCount);
  console.log('');

  console.log('='.repeat(70));
  console.log('PNL BREAKDOWN');
  console.log('='.repeat(70));
  console.log('Trading PnL (from sells):        $' + tradingPnl.toFixed(2));
  console.log('DB Resolved PnL:                 $' + dbResolvedPnl.toFixed(2));
  console.log('Exact 100%/0% PnL:               $' + exactZeroOrHundredPnl.toFixed(2));
  console.log('─'.repeat(45));
  console.log('TOTAL REALIZED:                  $' + (tradingPnl + dbResolvedPnl + exactZeroOrHundredPnl).toFixed(2));
  console.log('');
  console.log('True Unrealized PnL:             $' + trueUnrealizedPnl.toFixed(2));
  console.log('');

  const totalRealized = tradingPnl + dbResolvedPnl + exactZeroOrHundredPnl;
  const grandTotal = totalRealized + trueUnrealizedPnl;

  console.log('='.repeat(70));
  console.log('VALIDATION');
  console.log('='.repeat(70));
  console.log('UI Total PnL:                    $98,723.27');
  console.log('Our Grand Total:                 $' + grandTotal.toFixed(2));
  console.log('Difference:                      $' + (98723.27 - grandTotal).toFixed(2));
  console.log('');
  console.log('UI Total - True Unrealized:      $' + (98723.27 - trueUnrealizedPnl).toFixed(2));
  console.log('Our Total Realized:              $' + totalRealized.toFixed(2));
  console.log('Difference:                      $' + ((98723.27 - trueUnrealizedPnl) - totalRealized).toFixed(2));
  console.log('');
  console.log('Our Original Engine Output:      $82,220.85');
  console.log('');

  if (trueUnrealizedPositions.length > 0) {
    console.log('='.repeat(70));
    console.log('TRUE UNREALIZED POSITIONS (sample)');
    console.log('='.repeat(70));
    for (const p of trueUnrealizedPositions.slice(0, 10)) {
      console.log(`  ${p.condition_id}... | ${p.outcome_index === 0 ? 'YES' : 'NO'} | ${p.shares.toFixed(0)} shares | avg: ${(p.avgPrice * 100).toFixed(1)}¢ | now: ${(p.currentPrice * 100).toFixed(1)}¢ | PnL: $${p.pnl.toFixed(2)}`);
    }
  }

  if (exactZeroOrHundredPositions.length > 0) {
    console.log('');
    console.log('='.repeat(70));
    console.log('EXACT 100%/0% POSITIONS (treating as realized)');
    console.log('='.repeat(70));
    for (const p of exactZeroOrHundredPositions) {
      console.log(`  ${p.condition_id}... | ${p.outcome_index === 0 ? 'YES' : 'NO'} | ${p.shares.toFixed(0)} shares | avg: ${(p.avgPrice * 100).toFixed(1)}¢ | now: ${(p.currentPrice * 100).toFixed(0)}¢ | PnL: $${p.pnl.toFixed(2)}`);
    }
  }
}

calculate();
