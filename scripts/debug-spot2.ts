import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function debug() {
  const wallet = '0xee81df87bc51eebc6a050bb70638c5e56063ef68';
  
  // Get trades and process
  const tradesQuery = "SELECT token_id, side, usdc_amount / token_amount as price, token_amount / 1000000.0 as amount FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '" + wallet + "' ORDER BY trade_time ASC";
  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = await tradesResult.json() as any[];
  
  const positions = new Map<string, { amount: number; avgPrice: number; realizedPnl: number }>();
  for (const trade of trades) {
    let pos = positions.get(trade.token_id);
    if (!pos) {
      pos = { amount: 0, avgPrice: 0, realizedPnl: 0 };
      positions.set(trade.token_id, pos);
    }
    
    if (trade.side === 'buy') {
      const newAmount = pos.amount + trade.amount;
      if (newAmount > 0) pos.avgPrice = (pos.avgPrice * pos.amount + trade.price * trade.amount) / newAmount;
      pos.amount = newAmount;
    } else {
      const adj = Math.min(trade.amount, pos.amount);
      if (adj > 0) {
        pos.realizedPnl += adj * (trade.price - pos.avgPrice);
        pos.amount -= adj;
      }
    }
  }
  
  // Get open positions with token mapping
  const openPositions: Array<{tokenId: string; amount: number; avgPrice: number; realizedPnl: number}> = [];
  for (const [tokenId, pos] of positions.entries()) {
    if (pos.amount > 0.001) {
      openPositions.push({ tokenId, ...pos });
    }
  }
  
  console.log('Open positions:', openPositions.length);
  
  // Get token -> condition mapping
  const tokenIds = openPositions.map(p => "'" + p.tokenId + "'").join(',');
  const mapQuery = "SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5 WHERE token_id_dec IN (" + tokenIds + ")";
  const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
  const mappings = await mapResult.json() as any[];
  
  const tokenMap = new Map<string, {conditionId: string; outcomeIndex: number}>();
  for (const m of mappings) {
    tokenMap.set(m.token_id_dec, { conditionId: m.condition_id, outcomeIndex: m.outcome_index });
  }
  
  // Get resolution prices
  const condIds = [...new Set(mappings.map(m => "'" + m.condition_id.toLowerCase() + "'"))].join(',');
  const resQuery = "SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (" + condIds + ")";
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = await resResult.json() as any[];
  
  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    resMap.set(r.condition_id, r.norm_prices);
  }
  
  // Calculate what the resolved positions are worth
  let tradePnl = 0;
  for (const pos of positions.values()) {
    tradePnl += pos.realizedPnl;
  }
  
  let totalCostBasis = 0;
  let totalResolutionValue = 0;
  let winners = 0;
  let losers = 0;
  
  for (const pos of openPositions) {
    const mapping = tokenMap.get(pos.tokenId);
    if (!mapping) continue;
    
    const prices = resMap.get(mapping.conditionId.toLowerCase());
    if (!prices) continue;
    
    const resolutionPrice = prices[mapping.outcomeIndex] || 0;
    const costBasis = pos.amount * pos.avgPrice;
    const resValue = pos.amount * resolutionPrice;
    
    totalCostBasis += costBasis;
    totalResolutionValue += resValue;
    
    if (resolutionPrice > 0.5) {
      winners++;
    } else {
      losers++;
    }
  }
  
  console.log('Winners:', winners, 'Losers:', losers);
  console.log('Total cost basis:', totalCostBasis.toFixed(2));
  console.log('Total resolution value:', totalResolutionValue.toFixed(2));
  console.log('Unrealized PnL from resolutions:', (totalResolutionValue - totalCostBasis).toFixed(2));
  console.log('Trade PnL:', tradePnl.toFixed(2));
  console.log('Total PnL:', (tradePnl + totalResolutionValue - totalCostBasis).toFixed(2));
}

debug().catch(console.error);
