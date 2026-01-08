#!/usr/bin/env npx tsx
/**
 * Polymarket Exact Formula Implementation
 *
 * Based on the actual Polymarket subgraph code:
 * - updateUserPositionWithBuy: weighted avg cost basis
 * - updateUserPositionWithSell: PnL = min(sellAmt, trackedAmt) * (sellPrice - avgPrice)
 *
 * Key insight: Sells are CAPPED at tracked inventory. External tokens don't contribute to PnL.
 *
 * Data sources we try:
 * 1. V3 CLOB only (all maker + taker trades)
 * 2. V3 CLOB + CTF events (splits create inventory at $0.50)
 * 3. V3 CLOB + proxy ERC1155 attribution (tokens received from proxies)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

const BENCHMARK_WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const UI_PNL = 58.41;

interface Position {
  amount: number;       // Current tracked inventory
  avgPrice: number;     // Weighted average cost basis
  totalBought: number;  // Cumulative buys
  realizedPnl: number;  // Accumulated realized P&L
}

interface Event {
  type: 'buy' | 'sell' | 'split' | 'merge' | 'redemption';
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;
  amount: number;     // tokens
  price: number;      // per token
  timestamp: string;
  source: string;     // 'clob', 'ctf', 'proxy'
}

function newPosition(): Position {
  return { amount: 0, avgPrice: 0, totalBought: 0, realizedPnl: 0 };
}

function updateWithBuy(pos: Position, amount: number, price: number): Position {
  if (amount <= 0) return pos;

  // Weighted average cost basis (Polymarket formula)
  const newAmount = pos.amount + amount;
  const newAvgPrice = (pos.avgPrice * pos.amount + price * amount) / newAmount;

  return {
    ...pos,
    amount: newAmount,
    avgPrice: newAvgPrice,
    totalBought: pos.totalBought + amount,
  };
}

function updateWithSell(pos: Position, amount: number, price: number): Position {
  if (amount <= 0) return pos;

  // KEY INSIGHT: Cap sell at tracked inventory
  const adjustedAmount = Math.min(amount, pos.amount);

  // PnL = adjustedAmount * (sellPrice - avgPrice)
  const pnlDelta = adjustedAmount * (price - pos.avgPrice);

  return {
    ...pos,
    amount: pos.amount - adjustedAmount,
    realizedPnl: pos.realizedPnl + pnlDelta,
  };
}

async function loadClobEvents(): Promise<Event[]> {
  const query = `
    SELECT
      token_id as tokenId,
      m.condition_id as conditionId,
      m.outcome_index as outcomeIndex,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      trade_time as timestamp
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_current m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = lower('${BENCHMARK_WALLET}')
      AND m.condition_id IS NOT NULL
    ORDER BY trade_time, t.token_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    type: r.side === 'buy' ? 'buy' : 'sell' as const,
    tokenId: r.tokenId,
    conditionId: r.conditionId,
    outcomeIndex: Number(r.outcomeIndex),
    amount: r.tokens,
    price: r.tokens > 0 ? r.usdc / r.tokens : 0,
    timestamp: r.timestamp,
    source: 'clob',
  }));
}

async function loadCTFEvents(): Promise<Event[]> {
  const query = `
    SELECT
      event_type,
      condition_id as conditionId,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp as timestamp
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = lower('${BENCHMARK_WALLET}')
    ORDER BY event_timestamp
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  // Get token map for conditions
  const conditionIds = [...new Set(rows.map(r => r.conditionId.toLowerCase()))];
  const tokenMap = await getTokenMapForConditions(conditionIds);

  const events: Event[] = [];

  for (const r of rows) {
    const tokens = tokenMap.get(r.conditionId.toLowerCase());
    if (!tokens) continue;

    if (r.event_type === 'PositionSplit') {
      // Split creates BOTH YES and NO at $0.50 each
      events.push({
        type: 'buy',
        tokenId: tokens.yes,
        conditionId: r.conditionId,
        outcomeIndex: 0,
        amount: r.amount,
        price: 0.50,
        timestamp: r.timestamp,
        source: 'ctf_split',
      });
      events.push({
        type: 'buy',
        tokenId: tokens.no,
        conditionId: r.conditionId,
        outcomeIndex: 1,
        amount: r.amount,
        price: 0.50,
        timestamp: r.timestamp,
        source: 'ctf_split',
      });
    } else if (r.event_type === 'PositionsMerge') {
      // Merge destroys BOTH at $0.50 each
      events.push({
        type: 'sell',
        tokenId: tokens.yes,
        conditionId: r.conditionId,
        outcomeIndex: 0,
        amount: r.amount,
        price: 0.50,
        timestamp: r.timestamp,
        source: 'ctf_merge',
      });
      events.push({
        type: 'sell',
        tokenId: tokens.no,
        conditionId: r.conditionId,
        outcomeIndex: 1,
        amount: r.amount,
        price: 0.50,
        timestamp: r.timestamp,
        source: 'ctf_merge',
      });
    } else if (r.event_type === 'PayoutRedemption') {
      // Redemption - need resolution to know which side paid out
      // For now, add as redemption event to be processed with resolution data
      events.push({
        type: 'redemption',
        tokenId: tokens.yes, // Will be matched later
        conditionId: r.conditionId,
        outcomeIndex: -1, // Unknown until we check resolution
        amount: r.amount, // This is USDC received, not tokens
        price: 1.0, // Winning tokens redeem at $1
        timestamp: r.timestamp,
        source: 'ctf_redemption',
      });
    }
  }

  return events;
}

async function loadProxyERC1155Events(): Promise<Event[]> {
  // Tokens received from known proxy contracts
  const PROXY_ADDRESSES = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  ];

  const proxyList = PROXY_ADDRESSES.map(p => `'${p}'`).join(',');

  const query = `
    SELECT
      token_id as tokenIdHex,
      block_timestamp as timestamp,
      value as valueHex
    FROM pm_erc1155_transfers
    WHERE is_deleted = 0
      AND lower(to_address) = lower('${BENCHMARK_WALLET}')
      AND lower(from_address) IN (${proxyList})
    ORDER BY block_timestamp
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const events: Event[] = [];

  for (const r of rows) {
    // Convert hex token_id to decimal
    const tokenIdHex = r.tokenIdHex.startsWith('0x') ? r.tokenIdHex.slice(2) : r.tokenIdHex;
    const tokenIdDec = BigInt('0x' + tokenIdHex).toString();

    // Convert hex value to decimal
    const valueHex = r.valueHex.startsWith('0x') ? r.valueHex.slice(2) : r.valueHex;
    const tokens = Number(BigInt('0x' + valueHex)) / 1e6;

    // Get condition mapping
    const mapping = await getTokenMapping(tokenIdDec);
    if (!mapping) continue;

    events.push({
      type: 'buy', // Receiving tokens = adding to inventory
      tokenId: tokenIdDec,
      conditionId: mapping.conditionId,
      outcomeIndex: mapping.outcomeIndex,
      amount: tokens,
      price: 0.50, // Proxy splits cost $0.50 per token
      timestamp: r.timestamp,
      source: 'proxy_erc1155',
    });
  }

  return events;
}

async function getTokenMapForConditions(conditionIds: string[]): Promise<Map<string, { yes: string; no: string }>> {
  if (conditionIds.length === 0) return new Map();

  const conditionList = conditionIds.map(c => `'${c}'`).join(',');
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_current
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, { yes?: string; no?: string }>();
  for (const row of rows) {
    const entry = map.get(row.condition_id) || {};
    if (row.outcome_index === 0) entry.yes = row.token_id_dec;
    else entry.no = row.token_id_dec;
    map.set(row.condition_id, entry);
  }

  const result2 = new Map<string, { yes: string; no: string }>();
  for (const [cid, tokens] of map) {
    if (tokens.yes && tokens.no) {
      result2.set(cid, { yes: tokens.yes, no: tokens.no });
    }
  }

  return result2;
}

async function getTokenMapping(tokenIdDec: string): Promise<{ conditionId: string; outcomeIndex: number } | null> {
  const query = `
    SELECT condition_id, outcome_index
    FROM pm_token_to_condition_map_current
    WHERE token_id_dec = '${tokenIdDec}'
    LIMIT 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) return null;
  return { conditionId: rows[0].condition_id, outcomeIndex: Number(rows[0].outcome_index) };
}

async function loadResolutions(): Promise<Map<string, number[]>> {
  const query = `
    SELECT
      condition_id,
      norm_prices
    FROM pm_condition_resolutions_norm
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (row.norm_prices && Array.isArray(row.norm_prices)) {
      map.set(row.condition_id.toLowerCase(), row.norm_prices);
    }
  }

  return map;
}

async function computePnL(events: Event[], resolutions: Map<string, number[]>, label: string) {
  // Sort events by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Track positions per token
  const positions = new Map<string, Position>();

  // Process all events
  for (const event of events) {
    let pos = positions.get(event.tokenId) || newPosition();

    if (event.type === 'buy' || event.type === 'split') {
      pos = updateWithBuy(pos, event.amount, event.price);
    } else if (event.type === 'sell' || event.type === 'merge') {
      pos = updateWithSell(pos, event.amount, event.price);
    }
    // Skip redemption events for now - handled at end

    positions.set(event.tokenId, pos);
  }

  // Calculate final PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const [tokenId, pos] of positions) {
    // Add accumulated realized PnL from sells
    realizedPnl += pos.realizedPnl;

    // Get resolution for remaining inventory
    const mapping = await getTokenMapping(tokenId);
    if (!mapping) {
      // No mapping - mark at 0.5
      unrealizedPnl += pos.amount * (0.5 - pos.avgPrice);
      unresolvedCount++;
      continue;
    }

    const payouts = resolutions.get(mapping.conditionId.toLowerCase());
    if (payouts && payouts.length > mapping.outcomeIndex) {
      // Resolved - settle remaining inventory
      const payout = payouts[mapping.outcomeIndex];
      realizedPnl += pos.amount * (payout - pos.avgPrice);
      resolvedCount++;
    } else {
      // Unresolved - mark at 0.5
      unrealizedPnl += pos.amount * (0.5 - pos.avgPrice);
      unresolvedCount++;
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl;
  const delta = totalPnl - UI_PNL;
  const deltaPct = (delta / Math.abs(UI_PNL) * 100).toFixed(1);

  console.log(`\n=== ${label} ===`);
  console.log(`  Events processed: ${events.length}`);
  console.log(`  Positions: ${positions.size}`);
  console.log(`  Resolved: ${resolvedCount}, Unresolved: ${unresolvedCount}`);
  console.log(`  Realized PnL: $${realizedPnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  Delta vs UI ($${UI_PNL}): ${delta >= 0 ? '+' : ''}$${delta.toFixed(2)} (${deltaPct}%)`);

  return { realizedPnl, unrealizedPnl, totalPnl, delta };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Polymarket Exact Formula Test                                ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Wallet: ${BENCHMARK_WALLET}`);
  console.log(`║  Target: $${UI_PNL} (from Polymarket UI)                      ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Load resolution data
  const resolutions = await loadResolutions();
  console.log(`\nLoaded ${resolutions.size} market resolutions`);

  // Test 1: CLOB only
  const clobEvents = await loadClobEvents();
  await computePnL([...clobEvents], resolutions, 'CLOB Only (V3)');

  // Test 2: CLOB + direct CTF events
  const ctfEvents = await loadCTFEvents();
  await computePnL([...clobEvents, ...ctfEvents], resolutions, 'CLOB + Direct CTF');

  // Test 3: CLOB + proxy ERC1155 (tokens from proxy splits)
  const proxyEvents = await loadProxyERC1155Events();
  await computePnL([...clobEvents, ...proxyEvents], resolutions, 'CLOB + Proxy ERC1155');

  // Test 4: All sources combined
  await computePnL([...clobEvents, ...ctfEvents, ...proxyEvents], resolutions, 'All Sources Combined');

  // Debug: Show inventory gaps
  console.log('\n=== Inventory Gap Analysis ===');
  const positions = new Map<string, { bought: number; sold: number }>();
  for (const e of clobEvents) {
    const pos = positions.get(e.tokenId) || { bought: 0, sold: 0 };
    if (e.type === 'buy') pos.bought += e.amount;
    else pos.sold += e.amount;
    positions.set(e.tokenId, pos);
  }

  let totalGap = 0;
  let tokensWithGap = 0;
  for (const [tokenId, pos] of positions) {
    const gap = pos.sold - pos.bought;
    if (gap > 0.01) {
      totalGap += gap;
      tokensWithGap++;
    }
  }
  console.log(`  Tokens with sell > buy: ${tokensWithGap}`);
  console.log(`  Total inventory gap: ${totalGap.toFixed(2)} tokens`);
  console.log(`  If gap filled at $0.50: $${(totalGap * 0.50).toFixed(2)} cost basis missing`);

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
