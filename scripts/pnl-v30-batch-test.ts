/**
 * PnL V30 - Batch Test
 * Test V30 on multiple wallets and collect results
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

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

interface Position {
  amount: number;
  avgPrice: number;
}

async function calculatePnl(wallet: string): Promise<{ realized: number; unrealized: number; negRiskConversions: number }> {
  const events: any[] = [];
  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;

  // Get CTF events
  const ctfResult = await clickhouse.query({
    query: `
      SELECT event_type, event_timestamp as timestamp, lower(condition_id) as condition_id,
             toFloat64OrZero(amount_or_payout) as amount, tx_hash
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0 AND event_timestamp > toDateTime('1970-01-01 01:00:00')
      ORDER BY event_timestamp ASC
    `,
    format: 'JSONEachRow',
  });
  const ctfRows = await ctfResult.json() as any[];

  for (const row of ctfRows) {
    if (row.event_type === 'PositionSplit') {
      events.push({ type: 'BUY', ts: new Date(row.timestamp), cid: row.condition_id, oi: 0, amt: row.amount, price: FIFTY_CENTS });
      events.push({ type: 'BUY', ts: new Date(row.timestamp), cid: row.condition_id, oi: 1, amt: row.amount, price: FIFTY_CENTS });
    } else if (row.event_type === 'PositionsMerge') {
      events.push({ type: 'SELL', ts: new Date(row.timestamp), cid: row.condition_id, oi: 0, amt: row.amount, price: FIFTY_CENTS });
      events.push({ type: 'SELL', ts: new Date(row.timestamp), cid: row.condition_id, oi: 1, amt: row.amount, price: FIFTY_CENTS });
    }
  }

  // Get CLOB trades
  const clobResult = await clickhouse.query({
    query: `
      SELECT toString(t.trade_time) as timestamp, lower(m.condition_id) as condition_id,
             m.outcome_index, t.side, max(t.token_amount) as amount, max(t.usdc_amount) as usdc_amount
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}' AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });
  const clobRows = await clobResult.json() as any[];

  for (const row of clobRows) {
    const price = Math.round((row.usdc_amount * COLLATERAL_SCALE) / row.amount);
    events.push({
      type: row.side === 'buy' ? 'BUY' : 'SELL',
      ts: new Date(row.timestamp),
      cid: row.condition_id,
      oi: row.outcome_index,
      amt: row.amount,
      price: price,
    });
  }

  // Count Neg Risk conversions
  const convResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_neg_risk_conversions_v1 WHERE lower(user_address) = '${wallet.toLowerCase()}' AND is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const convRows = await convResult.json() as any[];
  const negRiskConversions = convRows[0]?.cnt || 0;

  // Sort events
  events.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  function getPosition(cid: string, oi: number): Position {
    const key = `${cid}_${oi}`;
    let pos = positions.get(key);
    if (!pos) { pos = { amount: 0, avgPrice: 0 }; positions.set(key, pos); }
    return pos;
  }

  function handleBuy(cid: string, oi: number, amount: number, price: number) {
    const pos = getPosition(cid, oi);
    if (pos.amount + amount > 0) {
      pos.avgPrice = (pos.avgPrice * pos.amount + price * amount) / (pos.amount + amount);
    }
    pos.amount += amount;
  }

  function handleSell(cid: string, oi: number, amount: number, price: number): number {
    const pos = getPosition(cid, oi);
    const adj = Math.min(amount, pos.amount);
    if (adj > 0) {
      const pnl = (adj * (price - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
      pos.amount -= adj;
      return pnl;
    }
    return 0;
  }

  // Process events
  for (const e of events) {
    if (e.type === 'BUY') handleBuy(e.cid, e.oi, e.amt, e.price);
    else totalRealizedPnl += handleSell(e.cid, e.oi, e.amt, e.price);
  }

  // Process redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT lower(c.condition_id) as condition_id, sum(toFloat64OrZero(c.amount_or_payout)) as redeemed_amount, r.norm_prices
      FROM pm_ctf_events c
      LEFT JOIN pm_condition_resolutions_norm r ON lower(c.condition_id) = lower(r.condition_id)
      WHERE lower(c.user_address) = '${wallet.toLowerCase()}' AND c.event_type = 'PayoutRedemption' AND c.is_deleted = 0
      GROUP BY c.condition_id, r.norm_prices
    `,
    format: 'JSONEachRow',
  });
  const redemptionRows = await redemptionResult.json() as any[];

  for (const row of redemptionRows) {
    const prices = row.norm_prices || [0, 0];
    for (let oi = 0; oi < prices.length; oi++) {
      if (prices[oi] === 1) {
        const pos = getPosition(row.condition_id, oi);
        if (pos.amount > 0) {
          totalRealizedPnl += handleSell(row.condition_id, oi, pos.amount, COLLATERAL_SCALE);
        }
      }
    }
  }

  // Calculate unrealized
  let totalUnrealized = 0;
  const conditionIds = Array.from(new Set([...positions.keys()].map(k => k.split('_')[0])));
  const resolutions = new Map<string, number[]>();

  const BATCH_SIZE = 500;
  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    const idList = batch.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0`,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) resolutions.set(row.condition_id, row.norm_prices);
  }

  for (const [key, pos] of positions) {
    if (pos.amount > 0.01) {
      const [cid, ois] = key.split('_');
      const oi = parseInt(ois);
      const prices = resolutions.get(cid);
      let currentPrice = prices && prices[oi] !== undefined ? prices[oi] * COLLATERAL_SCALE : 0;
      totalUnrealized += (pos.amount * (currentPrice - pos.avgPrice)) / COLLATERAL_SCALE / COLLATERAL_SCALE;
    }
  }

  return { realized: totalRealizedPnl, unrealized: totalUnrealized, negRiskConversions };
}

async function main() {
  // Test wallets
  const wallets = [
    '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb',  // Original test wallet (no Neg Risk)
    '0x3eee293c5dee12a7aa692e21c4b50bb8fc3fe8b6',
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0x64f314fcceed6885d621a6a1fde5a494ee7a70c4',
    '0x742ff6df87485287bb4db5b0d7fa7af13047d673',
  ];

  console.log('Wallet                                      | NegRisk | Realized  | Unrealized | Total     | API       | R vs API');
  console.log('-'.repeat(120));

  for (const wallet of wallets) {
    try {
      const apiPnl = await fetchApiPnl(wallet);
      const { realized, unrealized, negRiskConversions } = await calculatePnl(wallet);
      const total = realized + unrealized;
      const diff = apiPnl !== null ? ((realized - apiPnl) / Math.abs(apiPnl) * 100) : NaN;

      console.log(
        `${wallet} | ${negRiskConversions.toString().padStart(6)} | ` +
        `$${realized.toFixed(2).padStart(9)} | ` +
        `$${unrealized.toFixed(2).padStart(9)} | ` +
        `$${total.toFixed(2).padStart(9)} | ` +
        `$${apiPnl?.toFixed(2).padStart(8) ?? 'N/A'.padStart(8)} | ` +
        `${diff.toFixed(1).padStart(6)}%`
      );
    } catch (e: any) {
      console.log(`${wallet} | ERROR: ${e.message.substring(0, 50)}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
