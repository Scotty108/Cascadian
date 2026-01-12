/**
 * PnL V31 - Dynamic Token Mapping
 *
 * Instead of relying on pre-computed token mapping, derive token_ids
 * from condition_ids on the fly using:
 *   token_id = keccak256(conditionId, outcomeSlotIndex)
 *
 * This fixes the 25K+ unmapped condition_ids issue.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

const COLLATERAL_SCALE = 1_000_000;
const FIFTY_CENTS = 500_000;

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

// Compute token_id from condition_id and outcome_index
function computeTokenId(conditionId: string, outcomeIndex: number): string {
  const condId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
  const packed = encodePacked(['bytes32', 'uint256'], [condId as `0x${string}`, BigInt(outcomeIndex)]);
  const hash = keccak256(packed);
  return BigInt(hash).toString();
}

interface Position {
  amount: number;
  avgPrice: number;
}

async function main() {
  const wallet = process.argv[2] || '0x3eee293c5dee12a7aa692e21c4b50bb8fc3fe8b6';

  console.log(`\n=== PNL V31 - DYNAMIC TOKEN MAPPING FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);

  // Step 1: Get all unique condition_ids this wallet has traded
  // Start from CTF events (redemptions, splits, merges) which have condition_id directly
  console.log('\nStep 1: Getting condition_ids from CTF events...');

  const ctfConditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(condition_id) as condition_id
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
        AND condition_id != ''
    `,
    format: 'JSONEachRow',
  });
  const ctfConditions = (await ctfConditionsResult.json() as any[]).map(r => r.condition_id);
  console.log(`  Found ${ctfConditions.length} conditions from CTF events`);

  // Step 2: For each condition, compute token_ids and look up CLOB trades
  console.log('\nStep 2: Looking up CLOB trades by computed token_ids...');

  interface TradeData {
    condition_id: string;
    outcome_index: number;
    side: string;
    tokens: number;
    usdc: number;
    timestamp: string;
  }

  const allTrades: TradeData[] = [];

  // Build token_id to condition mapping
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const conditionId of ctfConditions) {
    for (let oi = 0; oi < 2; oi++) {
      const tokenId = computeTokenId(conditionId, oi);
      tokenToCondition.set(tokenId, { conditionId, outcomeIndex: oi });
    }
  }

  // Look up CLOB trades using derived token_ids in batches
  const tokenIds = Array.from(tokenToCondition.keys());
  const BATCH_SIZE = 100;

  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const tokenIdList = batch.map(id => `'${id}'`).join(',');

    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          token_id,
          side,
          toString(trade_time) as timestamp,
          max(token_amount) as tokens,
          max(usdc_amount) as usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
          AND token_id IN (${tokenIdList})
        GROUP BY token_id, side, trade_time
      `,
      format: 'JSONEachRow',
    });

    const trades = await tradesResult.json() as any[];
    for (const trade of trades) {
      const mapping = tokenToCondition.get(trade.token_id);
      if (mapping) {
        allTrades.push({
          condition_id: mapping.conditionId,
          outcome_index: mapping.outcomeIndex,
          side: trade.side,
          tokens: trade.tokens,
          usdc: trade.usdc,
          timestamp: trade.timestamp,
        });
      }
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      console.log(`  Processed ${i}/${tokenIds.length} token_ids, found ${allTrades.length} trades...`);
    }
  }

  console.log(`  Total CLOB trades found: ${allTrades.length}`);

  // Step 3: Get CTF events (splits, merges)
  console.log('\nStep 3: Getting CTF events (splits, merges)...');

  const ctfEventsResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        toString(event_timestamp) as timestamp,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge')
      ORDER BY event_timestamp ASC
    `,
    format: 'JSONEachRow',
  });
  const ctfEvents = await ctfEventsResult.json() as any[];
  console.log(`  Found ${ctfEvents.length} split/merge events`);

  // Step 4: Build events list
  interface Event {
    type: string;
    timestamp: Date;
    conditionId: string;
    outcomeIndex: number;
    amount: number;
    price: number;
  }

  const events: Event[] = [];

  // Add CTF events
  for (const ctf of ctfEvents) {
    if (ctf.event_type === 'PositionSplit') {
      events.push({ type: 'BUY', timestamp: new Date(ctf.timestamp), conditionId: ctf.condition_id, outcomeIndex: 0, amount: ctf.amount, price: FIFTY_CENTS });
      events.push({ type: 'BUY', timestamp: new Date(ctf.timestamp), conditionId: ctf.condition_id, outcomeIndex: 1, amount: ctf.amount, price: FIFTY_CENTS });
    } else if (ctf.event_type === 'PositionsMerge') {
      events.push({ type: 'SELL', timestamp: new Date(ctf.timestamp), conditionId: ctf.condition_id, outcomeIndex: 0, amount: ctf.amount, price: FIFTY_CENTS });
      events.push({ type: 'SELL', timestamp: new Date(ctf.timestamp), conditionId: ctf.condition_id, outcomeIndex: 1, amount: ctf.amount, price: FIFTY_CENTS });
    }
  }

  // Add CLOB trades
  for (const trade of allTrades) {
    const price = Math.round((trade.usdc * COLLATERAL_SCALE) / trade.tokens);
    events.push({
      type: trade.side === 'buy' ? 'BUY' : 'SELL',
      timestamp: new Date(trade.timestamp),
      conditionId: trade.condition_id,
      outcomeIndex: trade.outcome_index,
      amount: trade.tokens,
      price: price,
    });
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  console.log(`  Total events: ${events.length}`);

  // Step 5: Process events with position tracking
  console.log('\nStep 5: Processing events with position tracking...');

  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;

  function getPosition(conditionId: string, outcomeIndex: number): Position {
    const key = `${conditionId}_${outcomeIndex}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { amount: 0, avgPrice: 0 };
      positions.set(key, pos);
    }
    return pos;
  }

  function handleBuy(conditionId: string, outcomeIndex: number, amount: number, price: number) {
    const pos = getPosition(conditionId, outcomeIndex);
    if (pos.amount + amount > 0) {
      pos.avgPrice = (pos.avgPrice * pos.amount + price * amount) / (pos.amount + amount);
    }
    pos.amount += amount;
  }

  function handleSell(conditionId: string, outcomeIndex: number, amount: number, price: number): number {
    const pos = getPosition(conditionId, outcomeIndex);
    const adjusted = Math.min(amount, pos.amount);
    if (adjusted > 0) {
      const deltaPnl = (adjusted * (price - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
      pos.amount -= adjusted;
      return deltaPnl;
    }
    return 0;
  }

  for (const event of events) {
    if (event.type === 'BUY') {
      handleBuy(event.conditionId, event.outcomeIndex, event.amount, event.price);
    } else {
      totalRealizedPnl += handleSell(event.conditionId, event.outcomeIndex, event.amount, event.price);
    }
  }

  // Step 6: Process redemptions
  console.log('\nStep 6: Processing redemptions...');

  const redemptionsResult = await clickhouse.query({
    query: `
      SELECT
        lower(c.condition_id) as condition_id,
        sum(toFloat64OrZero(c.amount_or_payout)) as redeemed_amount,
        r.norm_prices
      FROM pm_ctf_events c
      LEFT JOIN pm_condition_resolutions_norm r ON lower(c.condition_id) = lower(r.condition_id)
      WHERE lower(c.user_address) = '${wallet.toLowerCase()}'
        AND c.event_type = 'PayoutRedemption'
        AND c.is_deleted = 0
      GROUP BY c.condition_id, r.norm_prices
    `,
    format: 'JSONEachRow',
  });
  const redemptions = await redemptionsResult.json() as any[];

  let redemptionPnl = 0;
  for (const row of redemptions) {
    const prices = row.norm_prices || [0, 0];
    for (let oi = 0; oi < prices.length; oi++) {
      if (prices[oi] === 1) {
        const pos = getPosition(row.condition_id, oi);
        if (pos.amount > 0) {
          redemptionPnl += handleSell(row.condition_id, oi, pos.amount, COLLATERAL_SCALE);
        }
      }
    }
  }
  totalRealizedPnl += redemptionPnl;
  console.log(`  Redemption PnL contribution: $${redemptionPnl.toFixed(2)}`);

  // Step 7: Calculate unrealized PnL
  console.log('\nStep 7: Calculating unrealized PnL...');

  const conditionIds = Array.from(new Set([...positions.keys()].map(k => k.split('_')[0])));
  const resolutions = new Map<string, number[]>();

  for (let i = 0; i < conditionIds.length; i += 500) {
    const batch = conditionIds.slice(i, i + 500);
    if (batch.length === 0) continue;
    const idList = batch.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0`,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  let totalUnrealized = 0;
  let positionsWithValue = 0;

  for (const [key, pos] of positions) {
    if (pos.amount > 0.01) {
      const [cid, ois] = key.split('_');
      const oi = parseInt(ois);
      const prices = resolutions.get(cid);
      const currentPrice = prices && prices[oi] !== undefined ? prices[oi] * COLLATERAL_SCALE : 0;
      const unrealized = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
      totalUnrealized += unrealized;
      if (Math.abs(unrealized) > 1) positionsWithValue++;
    }
  }
  console.log(`  Positions with unrealized > $1: ${positionsWithValue}`);

  // Final results
  console.log('\n=== FINAL PNL ===');
  console.log(`Realized PnL: $${totalRealizedPnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${totalUnrealized.toFixed(2)}`);
  const totalPnl = totalRealizedPnl + totalUnrealized;
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`\nAPI PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);

  if (apiPnl !== null) {
    const realizedDiff = totalRealizedPnl - apiPnl;
    const realizedPctDiff = (realizedDiff / Math.abs(apiPnl)) * 100;
    console.log(`\nRealized vs API: $${realizedDiff.toFixed(2)} (${realizedPctDiff.toFixed(2)}%)`);
  }

  process.exit(0);
}

main().catch(console.error);
