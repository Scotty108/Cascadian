/**
 * Complete PnL calculation with CORRECT payout interpretation
 * Winners get $1 per token, losers get $0 per token
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
}

async function main() {
  console.log('=== COMPLETE PNL CALCULATION V2 ===');
  console.log('Wallet:', wallet);
  console.log('Note: Winners get $1/token, losers get $0/token');

  // Load all trades with proper dedup
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

  const tradeRows = await trades.json() as Array<{
    token_id: string;
    side: string;
    usdc: number;
    tokens: number;
    price: number;
    trade_time: string;
  }>;

  console.log('Total trades:', tradeRows.length);

  // Track positions
  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;
  let skippedSells = 0;
  let clampedTokens = 0;

  for (const trade of tradeRows) {
    let pos = positions.get(trade.token_id) || {
      amount: 0,
      avgPrice: 0,
      realizedPnl: 0,
      tokenId: trade.token_id,
    };

    if (trade.side === 'buy') {
      const numerator = pos.avgPrice * pos.amount + trade.price * trade.tokens;
      const denominator = pos.amount + trade.tokens;
      pos.avgPrice = denominator > 0 ? numerator / denominator : trade.price;
      pos.amount += trade.tokens;
    } else {
      const adjustedAmount = Math.min(trade.tokens, pos.amount);
      if (adjustedAmount <= 0) {
        skippedSells++;
      } else {
        const clamped = trade.tokens - adjustedAmount;
        if (clamped > 0) clampedTokens += clamped;
        const deltaPnl = adjustedAmount * (trade.price - pos.avgPrice);
        pos.realizedPnl += deltaPnl;
        totalRealizedPnl += deltaPnl;
        pos.amount -= adjustedAmount;
      }
    }

    positions.set(trade.token_id, pos);
  }

  console.log('\nFrom trades:');
  console.log('  Realized PnL:', '$' + totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('  Skipped sells:', skippedSells);
  console.log('  Clamped tokens:', clampedTokens.toLocaleString());

  // Get open positions (amount > 0)
  const openPositions: Position[] = [];
  for (const pos of positions.values()) {
    if (pos.amount > 0) {
      openPositions.push(pos);
    }
  }

  console.log('  Open positions:', openPositions.length);

  // Get condition mapping for open positions
  const tokenIds = openPositions.map(p => p.tokenId);
  if (tokenIds.length === 0) {
    console.log('\nNo open positions to analyze.');
    return;
  }

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

  // Get resolutions
  const conditionIds = [...new Set([...conditionMap.values()].map(c => c.condition_id))];
  const resolutions = await client.query({
    query: `
      SELECT condition_id, payout_numerators, payout_denominator, resolved_at
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionIds.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow',
  });

  const resolutionMap = new Map<string, { payouts: number[] }>();
  for (const row of await resolutions.json() as Array<{
    condition_id: string;
    payout_numerators: string;
    payout_denominator: string;
  }>) {
    resolutionMap.set(row.condition_id, {
      payouts: JSON.parse(row.payout_numerators),
    });
  }

  // Calculate unrealized PnL
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
      // CORRECT interpretation: if payout[outcomeIndex] > 0, winner gets $1/token
      const isWinner = res.payouts[cond.outcome_index] > 0;
      currentValue = isWinner ? pos.amount * 1.0 : 0; // $1 per token for winner, $0 for loser
      status = isWinner ? 'WON ($1/token)' : 'LOST ($0/token)';
    } else {
      // Unresolved - use avg price (conservative)
      currentValue = costBasis;
    }

    totalCurrentValue += currentValue;
    const unrealized = currentValue - costBasis;
    totalUnrealizedPnl += unrealized;

    console.log(`\n${(cond.question || 'Unknown').substring(0, 50)}`);
    console.log(`  Tokens: ${pos.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Avg Price: $${pos.avgPrice.toFixed(4)}`);
    console.log(`  Cost: $${costBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Value: $${currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Unrealized: $${unrealized.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Status: ${status}`);
  }

  console.log('\n=== FINAL SUMMARY ===');
  console.log('Realized PnL (trades):', '$' + totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Open position cost:', '$' + totalCostBasis.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Open position value:', '$' + totalCurrentValue.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Unrealized PnL:', '$' + totalUnrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('');
  console.log('TOTAL PnL:', '$' + (totalRealizedPnl + totalUnrealizedPnl).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('');
  console.log('UI PnL (WebFetch):', '$1,409,525');
  console.log('Delta:', '$' + (totalRealizedPnl + totalUnrealizedPnl - 1409525).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  console.log('Delta %:', ((totalRealizedPnl + totalUnrealizedPnl - 1409525) / 1409525 * 100).toFixed(1) + '%');
}

main().catch(console.error);
