/**
 * PnL FIFO Debug - Check if FIFO vs LIFO matters
 *
 * The issue might be simpler: when we have a sell before a buy,
 * we create a "short" position. Let's trace this carefully.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface Trade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  price: number;
  tokens: number;
  usdc: number;
  ts: number;
}

async function getTrades(wallet: string): Promise<Trade[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      m.outcome_index,
      t.side,
      max(t.usdc_amount) / max(t.token_amount) as price,
      max(t.token_amount) / 1000000.0 as tokens,
      max(t.usdc_amount) / 1000000.0 as usdc,
      max(toUnixTimestamp(t.trade_time)) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ORDER BY ts ASC, tx_hash ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => ({
    tx_hash: r.tx_hash,
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    side: r.side.toLowerCase(),
    price: Number(r.price),
    tokens: Number(r.tokens),
    usdc: Number(r.usdc),
    ts: Number(r.ts),
  }));
}

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

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== SIMPLE CASHFLOW PNL FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Simple approach: sum all cash flows + position value at resolution
  // This should ALWAYS work regardless of trade order

  interface Position {
    tokensBought: number;
    tokensSold: number;
    cashPaid: number;
    cashReceived: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = { tokensBought: 0, tokensSold: 0, cashPaid: 0, cashReceived: 0 };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      pos.tokensBought += trade.tokens;
      pos.cashPaid += trade.usdc;
    } else {
      pos.tokensSold += trade.tokens;
      pos.cashReceived += trade.usdc;
    }
  }

  // Get resolutions
  const conditionIds = Array.from(new Set(Array.from(positions.keys()).map(k => k.split('_')[0])));
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  let resolutions = new Map<string, number[]>();
  if (conditionIds.length > 0) {
    const query = `
      SELECT lower(condition_id) as condition_id, norm_prices
      FROM pm_condition_resolutions_norm
      WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
    `;
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
    for (const row of rows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // PnL = cash_received - cash_paid + tokens_held * resolution_price
  // Where tokens_held = tokensBought - tokensSold

  let totalPnl = 0;

  console.log(`\n=== POSITION-BY-POSITION BREAKDOWN ===`);
  console.log('condition_id         | idx | bought | sold   | held   | paid    | rcvd    | res  | pnl');
  console.log('-'.repeat(110));

  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const prices = resolutions.get(conditionId);
    const resPrice = prices && prices.length > outcomeIndex ? prices[outcomeIndex] : 0;

    const tokensHeld = pos.tokensBought - pos.tokensSold;
    const netCash = pos.cashReceived - pos.cashPaid;
    const positionValue = tokensHeld * resPrice;
    const pnl = netCash + positionValue;

    if (Math.abs(pnl) > 0.1 || Math.abs(tokensHeld) > 0.1) {
      console.log(
        `${conditionId.substring(0, 20)}... | ${outcomeIndex}   | ` +
        `${pos.tokensBought.toFixed(1).padStart(6)} | ` +
        `${pos.tokensSold.toFixed(1).padStart(6)} | ` +
        `${tokensHeld.toFixed(1).padStart(6)} | ` +
        `$${pos.cashPaid.toFixed(2).padStart(6)} | ` +
        `$${pos.cashReceived.toFixed(2).padStart(6)} | ` +
        `${resPrice.toFixed(1).padStart(4)} | ` +
        `$${pnl.toFixed(2).padStart(7)}`
      );
    }

    totalPnl += pnl;
  }

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:   $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // Now let's check what happens if we DON'T count position value for negative holdings
  console.log(`\n=== ALTERNATIVE: Ignore negative position values ===`);

  let altPnl = 0;
  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const prices = resolutions.get(conditionId);
    const resPrice = prices && prices.length > outcomeIndex ? prices[outcomeIndex] : 0;

    const tokensHeld = pos.tokensBought - pos.tokensSold;
    const netCash = pos.cashReceived - pos.cashPaid;

    // Only count positive token values
    const positionValue = tokensHeld > 0 ? tokensHeld * resPrice : 0;
    const pnl = netCash + positionValue;

    altPnl += pnl;
  }

  console.log(`Alt PnL:   $${altPnl.toFixed(2)}`);
  console.log(`API PnL:   $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (altPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

main().catch(console.error);
