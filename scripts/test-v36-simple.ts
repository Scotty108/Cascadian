/**
 * Test V36 on multiple simple wallets to establish accuracy baseline
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

async function calculatePnl(wallet: string): Promise<{ realized: number; unrealized: number; excl: number; api: number | null }> {
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  // Get CLOB trades with fill_id dedupe
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

  // Get redemptions
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

  // Calculate unrealized
  let unrealizedSum = 0;
  let unrealizedExclResolved = 0;

  for (const [key, pos] of positions) {
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
      unrealizedSum += unrealized;

      if (!isResolved) {
        unrealizedExclResolved += unrealized;
      }
    }
  }

  // Fetch API
  let apiPnl: number | null = null;
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        apiPnl = data[data.length - 1].p;
      }
    }
  } catch {}

  return {
    realized: totalRealized,
    unrealized: unrealizedSum,
    excl: unrealizedExclResolved,
    api: apiPnl,
  };
}

async function main() {
  // Get wallets with medium trade count (simpler profiles)
  const walletsResult = await clickhouse.query({
    query: `
      SELECT trader_wallet, count() as trade_count
      FROM pm_trader_events_v3
      GROUP BY trader_wallet
      HAVING trade_count BETWEEN 500 AND 2000
      ORDER BY rand()
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });
  const walletRows = await walletsResult.json() as any[];

  console.log('Testing V36 on 15 random wallets (500-2000 trades)...\n');
  console.log('Wallet                      | Trades | Realized   | Excl-Res   | API        | Diff     | % Diff');
  console.log('-'.repeat(100));

  let matched = 0;
  let total = 0;

  for (const row of walletRows) {
    const wallet = row.trader_wallet;
    const result = await calculatePnl(wallet);

    if (result.api === null) continue;
    total++;

    const totalExcl = result.realized + result.excl;
    const diff = totalExcl - result.api;
    const pctDiff = (diff / Math.abs(result.api || 1)) * 100;

    const match = Math.abs(pctDiff) < 5 ? '✅' : Math.abs(pctDiff) < 20 ? '⚠️' : '❌';
    if (Math.abs(pctDiff) < 5) matched++;

    console.log(
      `${wallet.substring(0, 26)}... | ${row.trade_count.toString().padStart(5)} | $${result.realized.toFixed(2).padStart(9)} | $${totalExcl.toFixed(2).padStart(9)} | $${result.api.toFixed(2).padStart(9)} | $${diff.toFixed(2).padStart(7)} | ${pctDiff.toFixed(1).padStart(6)}% ${match}`
    );
  }

  console.log('-'.repeat(100));
  console.log(`\nAccuracy: ${matched}/${total} within 5%`);

  process.exit(0);
}

main().catch(console.error);
