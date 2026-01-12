/**
 * Test V37 PnL calculation on fresh data - FIXED SCALING
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface Position {
  amount: number;     // in decimal (already divided by 1e6)
  avgPrice: number;   // in decimal (0.0 to 1.0)
  realizedPnl: number;
}

async function calculatePnl(wallet: string) {
  const walletLower = wallet.toLowerCase();

  const tradesResult = await clickhouse.query({
    query: `
      SELECT
        substring(t.event_id, 1, 66) as fill_id,
        sum(t.usdc_amount) / 1000000.0 as usdc,
        sum(t.token_amount) / 1000000.0 as tokens,
        any(t.side) as side,
        any(t.trade_time) as trade_time,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v3 t
      INNER JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${walletLower}'
      GROUP BY fill_id
      ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  const trades = await tradesResult.json() as any[];

  const resResult = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions WHERE is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const resRows = await resResult.json() as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    try {
      const payouts = JSON.parse(row.payout_numerators);
      if (Array.isArray(payouts)) {
        resolutions.set(row.condition_id.toLowerCase(), payouts);
      }
    } catch {}
  }

  const positions = new Map<string, Position>();
  let totalRealized = 0;

  for (const trade of trades) {
    const condId = trade.condition_id ? trade.condition_id.toLowerCase() : '';
    const key = condId + '_' + trade.outcome_index;
    const usdc = Number(trade.usdc) || 0;
    const tokens = Number(trade.tokens) || 0;
    const side = trade.side;

    if (!condId || tokens <= 0) continue;

    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0.5, realizedPnl: 0 });
    }
    const pos = positions.get(key)!;

    const price = usdc / tokens;  // Price per token in $

    if (side === 'buy') {
      const newAmount = pos.amount + tokens;
      if (newAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + price * tokens) / newAmount;
      }
      pos.amount = newAmount;
    } else {
      const sellAmount = Math.min(tokens, Math.max(0, pos.amount));
      if (sellAmount > 0) {
        const pnl = sellAmount * (price - pos.avgPrice);
        pos.realizedPnl += pnl;
        totalRealized += pnl;
        pos.amount -= sellAmount;
      }
    }
  }

  let unrealizedExclResolved = 0;
  for (const [key, pos] of positions) {
    if (pos.amount > 0) {
      const parts = key.split('_');
      const conditionId = parts.slice(0, -1).join('_');
      const outcomeIndex = parseInt(parts[parts.length - 1]);
      const res = resolutions.get(conditionId);

      let currentPrice = 0.5;
      let isResolved = false;

      if (res && res.length > outcomeIndex) {
        currentPrice = res[outcomeIndex];
        isResolved = true;
      }

      if (!isResolved) {
        const unrealized = pos.amount * (currentPrice - pos.avgPrice);
        unrealizedExclResolved += unrealized;
      }
    }
  }

  let apiPnl: number | null = null;
  try {
    const url = 'https://user-pnl-api.polymarket.com/user-pnl?user_address=' + walletLower;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as any[];
      if (data && data.length > 0) {
        apiPnl = data[data.length - 1].p;
      }
    }
  } catch {}

  return {
    realized: totalRealized,
    unrealized: unrealizedExclResolved,
    total: totalRealized + unrealizedExclResolved,
    api: apiPnl,
    trades: trades.length,
  };
}

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT trader_wallet, count() as cnt
      FROM pm_trader_events_v3
      GROUP BY trader_wallet
      HAVING cnt BETWEEN 50 AND 1000
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const wallets = await result.json() as any[];

  console.log('\nV37 Local PnL Test (20 wallets) - Fixed Scaling\n');
  console.log('Wallet                          | Trades | Local      | API        | Diff%  | Status');
  console.log('-'.repeat(95));

  let match = 0, close = 0, off = 0, noApi = 0;

  for (const row of wallets) {
    const pnl = await calculatePnl(row.trader_wallet);

    if (pnl.api === null) {
      console.log(row.trader_wallet.substring(0,30) + '... | ' + pnl.trades.toString().padStart(5) + ' | $' + pnl.total.toFixed(2).padStart(9) + ' | N/A        |        | ⏸️');
      noApi++;
    } else {
      const diff = pnl.total - pnl.api;
      const pct = Math.abs(pnl.api) > 0.01 ? (diff / Math.abs(pnl.api)) * 100 : 0;
      let status = '❌';
      if (Math.abs(pct) < 5) { status = '✅'; match++; }
      else if (Math.abs(pct) < 20) { status = '⚠️'; close++; }
      else { off++; }

      console.log(row.trader_wallet.substring(0,30) + '... | ' + pnl.trades.toString().padStart(5) + ' | $' + pnl.total.toFixed(2).padStart(9) + ' | $' + pnl.api.toFixed(2).padStart(9) + ' | ' + pct.toFixed(1).padStart(5) + '% | ' + status);
    }
  }

  console.log('-'.repeat(95));
  const tested = match + close + off;
  console.log('\n✅ Match (<5%): ' + match + '  |  ⚠️ Close (<20%): ' + close + '  |  ❌ Off (>20%): ' + off + '  |  ⏸️ No API: ' + noApi);
  if (tested > 0) {
    console.log('Accuracy: ' + ((match / tested) * 100).toFixed(1) + '% within 5%');
  }
}

main().catch(console.error);
