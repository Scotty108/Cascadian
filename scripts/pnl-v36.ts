/**
 * PnL V36 - GPT Framework Implementation
 *
 * This is V30 with proper naming. V30 matches API within 0.2% for simple wallets.
 * API returns: realized + unrealized_on_UNRESOLVED_only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1000000;
const FIFTY_CENTS = 500000;

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

function updatePositionWithBuy(pos: Position, amount: number, price: number): void {
  if (pos.amount + amount > 0) {
    pos.avgPrice = Math.round((pos.avgPrice * pos.amount + price * amount) / (pos.amount + amount));
  }
  pos.amount += amount;
}

function updatePositionWithSell(pos: Position, amount: number, price: number): void {
  const adjustedAmount = Math.min(amount, Math.max(0, pos.amount));
  if (adjustedAmount > 0) {
    const deltaPnl = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
    pos.realizedPnl += deltaPnl;
    pos.amount -= adjustedAmount;
  }
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  // Get CLOB trades - FIXED: Use fill_id (first 66 chars) for dedupe, sum() not max()
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        max(toUnixTimestamp(t.trade_time)) as ts,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        sum(t.token_amount) as tokens,
        sum(t.usdc_amount) as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const clobRows = await clobResult.json() as any[];
  for (const row of clobRows) {
    const price = Math.round((row.usdc * COLLATERAL_SCALE) / row.tokens);
    const pos = getPosition(row.condition_id, row.outcome_index);
    const amount = row.tokens / 1e6;

    if (row.side.toLowerCase() === 'buy') {
      updatePositionWithBuy(pos, amount, price);
    } else {
      updatePositionWithSell(pos, amount, price);
    }
  }

  // Get redemptions and process them
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(event_timestamp) as ts,
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];
  const redemptionConditionIds = [...new Set(redemptionRows.map((r: any) => r.condition_id))];

  // Get all resolutions
  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];
  const resolutions = new Map<string, number[]>();

  if (conditionIds.length > 0) {
    const idList = conditionIds.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (${idList})`,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // Process redemptions
  for (const row of redemptionRows) {
    const prices = resolutions.get(row.condition_id) ?? [0.5, 0.5];
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    const pos = getPosition(row.condition_id, winningOutcome);
    updatePositionWithSell(pos, row.amount / 1e6, COLLATERAL_SCALE);
  }

  // Calculate realized
  let totalRealized = 0;
  for (const pos of positions.values()) {
    totalRealized += pos.realizedPnl;
  }

  console.log('Total Realized PnL: $' + totalRealized.toFixed(2));

  // Show positions with remaining amount
  console.log('\nPositions with remaining tokens:');
  let unrealizedSum = 0;
  let unrealizedSumExcludeResolved = 0;

  for (const [key, pos] of positions) {
    if (Math.abs(pos.amount) > 0.001) {
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const res = resolutions.get(conditionId);

      let currentPrice = FIFTY_CENTS;
      let status = 'unresolved';
      let isResolved = false;

      if (res && res.length > outcomeIndex) {
        currentPrice = res[outcomeIndex] * COLLATERAL_SCALE;
        status = `resolved [${res.join(',')}]`;
        isResolved = true;
      }

      const unrealized = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE;
      unrealizedSum += unrealized;

      if (!isResolved) {
        unrealizedSumExcludeResolved += unrealized;
      }

      console.log(`${conditionId.substring(0, 24)}... O${outcomeIndex} | amount: ${pos.amount.toFixed(2)} | avgPrice: ${(pos.avgPrice/1e6).toFixed(4)} | currPrice: ${(currentPrice/1e6).toFixed(4)} | unrealized: $${unrealized.toFixed(2)} | ${status}`);
    }
  }

  console.log(`\nTotal Unrealized (all): $${unrealizedSum.toFixed(2)}`);
  console.log(`Total Unrealized (excl resolved): $${unrealizedSumExcludeResolved.toFixed(2)}`);
  console.log(`Total PnL (incl all unrealized): $${(totalRealized + unrealizedSum).toFixed(2)}`);
  console.log(`Total PnL (excl resolved unrealized): $${(totalRealized + unrealizedSumExcludeResolved).toFixed(2)}`);

  // Fetch API for comparison
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        console.log(`API PnL: $${data[data.length - 1].p.toFixed(2)}`);
      }
    }
  } catch {}

  process.exit(0);
}

main().catch(console.error);
