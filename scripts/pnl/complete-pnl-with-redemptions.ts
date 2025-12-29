/**
 * Complete PnL calculation with CLOB trades + PayoutRedemption events
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const client = getClickHouseClient();
const wallet = '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
  tokenId: string;
  conditionId?: string;
  outcomeIndex?: number;
}

interface TradeEvent {
  tokenId: string;
  side: 'buy' | 'sell';
  tokens: number;
  price: number;
  timestamp: Date;
  source: 'CLOB' | 'REDEMPTION';
}

async function loadClobTrades(): Promise<TradeEvent[]> {
  const trades = await client.query({
    query: `
      SELECT
        token_id,
        side,
        usdc,
        tokens,
        CASE WHEN tokens > 0 THEN usdc / tokens ELSE 0 END as price,
        trade_time
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1000000.0 as usdc,
          any(token_amount) / 1000000.0 as tokens,
          any(trade_time) as trade_time
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });

  const rows = await trades.json() as Array<{
    token_id: string;
    side: string;
    usdc: number;
    tokens: number;
    price: number;
    trade_time: string;
  }>;

  return rows.map(r => ({
    tokenId: r.token_id,
    side: r.side as 'buy' | 'sell',
    tokens: r.tokens,
    price: Math.min(1, Math.max(0, r.price)),
    timestamp: new Date(r.trade_time),
    source: 'CLOB' as const,
  }));
}

async function loadRedemptions(): Promise<TradeEvent[]> {
  // First get redemption events
  const redemptions = await client.query({
    query: `
      SELECT
        condition_id,
        toFloat64(amount_or_payout) / 1000000.0 as payout,
        event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY event_timestamp
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptions.json() as Array<{
    condition_id: string;
    payout: number;
    event_timestamp: string;
  }>;

  const events: TradeEvent[] = [];

  for (const r of redemptionRows) {
    // Find the winning token for this condition (the one with payout > 0)
    const tokenMap = await client.query({
      query: `
        SELECT m.token_id_dec, m.outcome_index
        FROM pm_token_to_condition_map_current m
        JOIN pm_condition_resolutions res ON m.condition_id = res.condition_id
        WHERE m.condition_id = '${r.condition_id}'
      `,
      format: 'JSONEachRow',
    });

    const tokens = await tokenMap.json() as Array<{
      token_id_dec: string;
      outcome_index: number;
    }>;

    // Find the resolution to know which outcome won
    const resolution = await client.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE condition_id = '${r.condition_id}'
      `,
      format: 'JSONEachRow',
    });

    const resRows = await resolution.json() as Array<{payout_numerators: string}>;
    if (resRows.length === 0) continue;

    const payouts = JSON.parse(resRows[0].payout_numerators);

    // Find the winning outcome
    for (const t of tokens) {
      if (payouts[t.outcome_index] > 0) {
        // This is the winning outcome - the redemption sells it at $1/token
        events.push({
          tokenId: t.token_id_dec,
          side: 'sell',
          tokens: r.payout, // payout amount equals tokens redeemed for winning outcome
          price: 1.0,       // $1 per token for winners
          timestamp: new Date(r.event_timestamp),
          source: 'REDEMPTION',
        });
      }
    }
  }

  return events;
}

async function main() {
  console.log('=== COMPLETE PNL WITH REDEMPTIONS ===');
  console.log('Wallet:', wallet);

  // Load all events
  const clobTrades = await loadClobTrades();
  const redemptions = await loadRedemptions();

  console.log('\nCLOB trades:', clobTrades.length);
  console.log('Redemption events:', redemptions.length);

  // Combine and sort chronologically
  const allEvents = [...clobTrades, ...redemptions].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  console.log('Total events:', allEvents.length);

  // Track positions
  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;
  let skippedSells = 0;
  let clampedTokens = 0;
  let redemptionPnl = 0;

  for (const event of allEvents) {
    let pos = positions.get(event.tokenId) || {
      amount: 0,
      avgPrice: 0,
      realizedPnl: 0,
      tokenId: event.tokenId,
    };

    if (event.side === 'buy') {
      const numerator = pos.avgPrice * pos.amount + event.price * event.tokens;
      const denominator = pos.amount + event.tokens;
      pos.avgPrice = denominator > 0 ? numerator / denominator : event.price;
      pos.amount += event.tokens;
    } else {
      const adjustedAmount = Math.min(event.tokens, pos.amount);
      if (adjustedAmount <= 0) {
        skippedSells++;
      } else {
        const clamped = event.tokens - adjustedAmount;
        if (clamped > 0) clampedTokens += clamped;
        const deltaPnl = adjustedAmount * (event.price - pos.avgPrice);
        pos.realizedPnl += deltaPnl;
        totalRealizedPnl += deltaPnl;
        pos.amount -= adjustedAmount;

        if (event.source === 'REDEMPTION') {
          redemptionPnl += deltaPnl;
        }
      }
    }

    positions.set(event.tokenId, pos);
  }

  console.log('\n=== REALIZED PNL ===');
  console.log('From CLOB trades:', '$' + (totalRealizedPnl - redemptionPnl).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('From redemptions:', '$' + redemptionPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Total realized:', '$' + totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Skipped sells:', skippedSells);
  console.log('Clamped tokens:', clampedTokens.toLocaleString());

  // Get open positions (amount > 0)
  const openPositions: Position[] = [];
  for (const pos of positions.values()) {
    if (pos.amount > 0) {
      openPositions.push(pos);
    }
  }

  console.log('Open positions:', openPositions.length);

  if (openPositions.length === 0) {
    console.log('\n=== FINAL ===');
    console.log('Total PnL:', '$' + totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
    console.log('UI PnL:', '$1,409,525');
    console.log('Delta:', '$' + (totalRealizedPnl - 1409525).toLocaleString(undefined, { maximumFractionDigits: 0 }));
    console.log('Delta %:', ((totalRealizedPnl - 1409525) / 1409525 * 100).toFixed(1) + '%');
    return;
  }

  // Get condition mapping and resolutions for open positions
  const tokenIds = openPositions.map(p => p.tokenId);
  const conditionQuery = await client.query({
    query: `
      SELECT token_id_dec, condition_id, outcome_index, question
      FROM pm_token_to_condition_map_current
      WHERE token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
    `,
    format: 'JSONEachRow',
  });

  const conditionMap = new Map<string, { condition_id: string; outcome_index: number; question: string }>();
  for (const row of await conditionQuery.json() as Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
  }>) {
    conditionMap.set(row.token_id_dec, row);
  }

  const conditionIds = [...new Set([...conditionMap.values()].map(c => c.condition_id))];
  const resolutions = await client.query({
    query: `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionIds.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow',
  });

  const resolutionMap = new Map<string, { payouts: number[] }>();
  for (const row of await resolutions.json() as Array<{
    condition_id: string;
    payout_numerators: string;
  }>) {
    resolutionMap.set(row.condition_id, {
      payouts: JSON.parse(row.payout_numerators),
    });
  }

  // Calculate unrealized
  let totalUnrealizedPnl = 0;
  let totalCostBasis = 0;
  let totalCurrentValue = 0;

  console.log('\n=== OPEN POSITIONS ===');
  for (const pos of openPositions) {
    const cond = conditionMap.get(pos.tokenId);
    if (!cond) continue;

    const costBasis = pos.amount * pos.avgPrice;
    totalCostBasis += costBasis;

    const res = resolutionMap.get(cond.condition_id);
    let currentValue = 0;
    let status = 'OPEN';

    if (res) {
      const isWinner = res.payouts[cond.outcome_index] > 0;
      currentValue = isWinner ? pos.amount * 1.0 : 0;
      status = isWinner ? 'WON' : 'LOST';
    } else {
      currentValue = costBasis; // Use cost basis for unresolved
    }

    totalCurrentValue += currentValue;
    const unrealized = currentValue - costBasis;
    totalUnrealizedPnl += unrealized;

    console.log(`${(cond.question || 'Unknown').substring(0, 40)}`);
    console.log(`  ${pos.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens @ $${pos.avgPrice.toFixed(4)}`);
    console.log(`  Cost: $${costBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Value: $${currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}, Status: ${status}`);
  }

  console.log('\n=== FINAL SUMMARY ===');
  console.log('Realized PnL:', '$' + totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Unrealized PnL:', '$' + totalUnrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('TOTAL PnL:', '$' + (totalRealizedPnl + totalUnrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('');
  console.log('UI PnL:', '$1,409,525');
  console.log('Delta:', '$' + (totalRealizedPnl + totalUnrealizedPnl - 1409525).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Delta %:', ((totalRealizedPnl + totalUnrealizedPnl - 1409525) / 1409525 * 100).toFixed(1) + '%');
}

main().catch(console.error);
