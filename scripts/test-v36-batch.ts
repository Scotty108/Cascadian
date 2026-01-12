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

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = 'https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet.toLowerCase();
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as any[];
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function calculatePnl(wallet: string) {
  const positions = new Map<string, Position>();
  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = conditionId + '_' + outcomeIndex;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  const clobResult = await clickhouse.query({
    query: 'SELECT max(toUnixTimestamp(t.trade_time)) as ts, lower(m.condition_id) as condition_id, m.outcome_index, t.side, sum(t.token_amount) as tokens, sum(t.usdc_amount) as usdc FROM pm_trader_events_v3 t JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec WHERE lower(t.trader_wallet) = \'' + wallet.toLowerCase() + '\' AND m.condition_id IS NOT NULL GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side ORDER BY ts ASC',
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

  const redemptionResult = await clickhouse.query({
    query: 'SELECT toUnixTimestamp(event_timestamp) as ts, lower(condition_id) as condition_id, toFloat64OrZero(amount_or_payout) as amount FROM pm_ctf_events WHERE lower(user_address) = \'' + wallet.toLowerCase() + '\' AND event_type = \'PayoutRedemption\' AND is_deleted = 0 ORDER BY ts ASC',
    format: 'JSONEachRow',
  });

  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];
  const resolutions = new Map<string, number[]>();

  if (conditionIds.length > 0) {
    const idList = conditionIds.map(id => '\'' + id + '\'').join(',');
    const resResult = await clickhouse.query({
      query: 'SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (' + idList + ')',
      format: 'JSONEachRow',
    });
    for (const row of await resResult.json() as any[]) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  const redemptionRows = await redemptionResult.json() as any[];
  for (const row of redemptionRows) {
    const prices = resolutions.get(row.condition_id) ?? [0.5, 0.5];
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    const pos = getPosition(row.condition_id, winningOutcome);
    updatePositionWithSell(pos, row.amount / 1e6, COLLATERAL_SCALE);
  }

  let totalRealized = 0;
  let unrealizedAll = 0;
  let unrealizedUnresolved = 0;

  for (const [key, pos] of positions) {
    totalRealized += pos.realizedPnl;
    if (Math.abs(pos.amount) > 0.001) {
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const res = resolutions.get(conditionId);

      let currentPrice = FIFTY_CENTS;
      let isResolved = false;

      if (res && res.length > outcomeIndex) {
        currentPrice = res[outcomeIndex] * COLLATERAL_SCALE;
        isResolved = true;
      }

      const unrealized = (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE;
      unrealizedAll += unrealized;
      if (!isResolved) {
        unrealizedUnresolved += unrealized;
      }
    }
  }

  const mtr = totalRealized + unrealizedAll;
  const exclResolved = totalRealized + unrealizedUnresolved;
  const apiPnl = await fetchApiPnl(wallet);

  return { mtr, exclResolved, apiPnl };
}

async function main() {
  // Wallets with ZERO neg-risk redemptions (truly simple)
  const wallets = [
    '0x40a2b83db36c0b581d9bce410779baf3cbaf3ec4',
    '0xd7c656f9e2ea97bd7e3a989560b8106dd56bb472',
    '0x56bf69c58e6e885634306af48a5f49da047012e1',
    '0x290fed6b069fee7e280c49e73d23caac31a14835',
    '0x39f34d679e28e42a1c7492cf44f1a9fdf5c179dd',
    '0x0ba59f8ef8c7a612286d93a569f86425a88c5f18',
    '0x99c769b9e0d61d025e9c6c2dbca9ae1e7545af31',
    '0xc05a35465d94d8a6a43a668ee042189ae19db225',
    '0xa842552d1c83dce0611a9548f1123a71a23de0a9',
    '0x65bbec5bac4284e3674b9c0e7b853820c3b0b830',
  ];

  console.log('Wallet       | MTR      | Excl Res | API      | MTR %   | Excl %');
  console.log('-------------|----------|----------|----------|---------|-------');

  for (const w of wallets) {
    try {
      const r = await calculatePnl(w);
      if (r.apiPnl !== null && Math.abs(r.apiPnl) > 0.01) {
        const mtrPct = ((r.mtr - r.apiPnl) / Math.abs(r.apiPnl) * 100).toFixed(1);
        const exclPct = ((r.exclResolved - r.apiPnl) / Math.abs(r.apiPnl) * 100).toFixed(1);
        console.log(
          w.substring(0, 10) + '... | $' +
          r.mtr.toFixed(2).padStart(6) + ' | $' +
          r.exclResolved.toFixed(2).padStart(6) + ' | $' +
          r.apiPnl.toFixed(2).padStart(6) + ' | ' +
          mtrPct.padStart(6) + '% | ' +
          exclPct.padStart(5) + '%'
        );
      } else {
        console.log(w.substring(0, 10) + '... | API returned null or 0');
      }
    } catch (e) {
      console.log(w.substring(0, 10) + '... | ERROR: ' + (e as Error).message?.substring(0, 30));
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
