import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

function updateWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
    realizedPnl: pos.realizedPnl,
  };
}

function updateWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount);
  if (adjustedAmount < 0.01) return pos;
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

async function testWallet(wallet: string) {
  console.log(`\nTesting wallet: ${wallet}\n`);
  
  // Load resolutions
  const mapQ = `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5`;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];
  
  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      condition_id: m.condition_id.toLowerCase(),
      outcome_index: parseInt(m.outcome_index),
    });
  }
  
  const resQ = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];
  
  const conditionResolutions = new Map<string, number[]>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      conditionResolutions.set(r.condition_id.toLowerCase(), payouts);
    } catch {}
  }
  
  const resolutionCache = new Map<string, { resolved: boolean; payout: number }>();
  for (const [tokenId, mapping] of tokenToCondition) {
    const payouts = conditionResolutions.get(mapping.condition_id);
    if (payouts && payouts.length > mapping.outcome_index) {
      resolutionCache.set(tokenId, {
        resolved: true,
        payout: payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0,
      });
    } else {
      resolutionCache.set(tokenId, { resolved: false, payout: 0 });
    }
  }
  console.log(`Loaded ${resolutionCache.size} resolutions`);
  
  // OLD query (bad dedup)
  const oldQ = `
    SELECT
      side, usdc / 1e6 AS usdc, tokens / 1e6 AS tokens, token_id, trade_time
    FROM (
      SELECT side, token_id, any(usdc_amount) AS usdc, token_amount AS tokens, max(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY transaction_hash, side, token_id, token_amount
    )
    ORDER BY trade_time
  `;
  
  // NEW query (correct dedup by event_id)
  const newQ = `
    SELECT
      side, usdc / 1e6 AS usdc, tokens / 1e6 AS tokens, token_id, trade_time
    FROM (
      SELECT event_id, any(side) AS side, any(token_id) AS token_id, any(usdc_amount) AS usdc, any(token_amount) AS tokens, any(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    ORDER BY trade_time
  `;
  
  const oldR = await clickhouse.query({ query: oldQ, format: 'JSONEachRow' });
  const oldTrades = (await oldR.json()) as any[];
  
  const newR = await clickhouse.query({ query: newQ, format: 'JSONEachRow' });
  const newTrades = (await newR.json()) as any[];
  
  console.log(`OLD dedup: ${oldTrades.length} trades`);
  console.log(`NEW dedup: ${newTrades.length} trades`);
  console.log(`Difference: ${oldTrades.length - newTrades.length} duplicate trades removed`);
  
  // Calculate PnL with OLD dedup
  let oldPositions = new Map<string, Position>();
  for (const trade of oldTrades) {
    const key = trade.token_id;
    let pos = oldPositions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
    if (trade.side === 'buy') pos = updateWithBuy(pos, price, trade.tokens);
    else if (trade.side === 'sell') pos = updateWithSell(pos, price, trade.tokens);
    oldPositions.set(key, pos);
  }
  
  // Calculate PnL with NEW dedup
  let newPositions = new Map<string, Position>();
  for (const trade of newTrades) {
    const key = trade.token_id;
    let pos = newPositions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
    if (trade.side === 'buy') pos = updateWithBuy(pos, price, trade.tokens);
    else if (trade.side === 'sell') pos = updateWithSell(pos, price, trade.tokens);
    newPositions.set(key, pos);
  }
  
  // Sum up PnL
  let oldTradingPnl = 0, oldResPnl = 0;
  for (const [tokenId, pos] of oldPositions) {
    oldTradingPnl += pos.realizedPnl;
    if (pos.amount > 0.01) {
      const res = resolutionCache.get(tokenId);
      if (res?.resolved) oldResPnl += pos.amount * (res.payout - pos.avgPrice);
    }
  }
  
  let newTradingPnl = 0, newResPnl = 0;
  for (const [tokenId, pos] of newPositions) {
    newTradingPnl += pos.realizedPnl;
    if (pos.amount > 0.01) {
      const res = resolutionCache.get(tokenId);
      if (res?.resolved) newResPnl += pos.amount * (res.payout - pos.avgPrice);
    }
  }
  
  console.log(`\n--- OLD DEDUP (broken) ---`);
  console.log(`Trading PnL: $${oldTradingPnl.toFixed(2)}`);
  console.log(`Resolution PnL: $${oldResPnl.toFixed(2)}`);
  console.log(`TOTAL Realized PnL: $${(oldTradingPnl + oldResPnl).toFixed(2)}`);
  
  console.log(`\n--- NEW DEDUP (fixed) ---`);
  console.log(`Trading PnL: $${newTradingPnl.toFixed(2)}`);
  console.log(`Resolution PnL: $${newResPnl.toFixed(2)}`);
  console.log(`TOTAL Realized PnL: $${(newTradingPnl + newResPnl).toFixed(2)}`);
  
  console.log(`\n--- COMPARISON ---`);
  console.log(`OLD: $${(oldTradingPnl + oldResPnl).toFixed(2)}`);
  console.log(`NEW: $${(newTradingPnl + newResPnl).toFixed(2)}`);
  console.log(`UI (target): -$3,452.32`);
}

// Test wallet #4 that showed +$113k but UI shows -$3,452
testWallet('0xda5fff24aa9d889d6366da205029c73093102e9b').catch(console.error);
