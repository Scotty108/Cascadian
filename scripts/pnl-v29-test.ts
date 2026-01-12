/**
 * PnL V29 - Test Multiple Wallets
 *
 * Formula:
 * PnL = CLOB_cash_flow - liability + redemptions + unredeemed_position_value
 *
 * Where:
 * - CLOB_cash_flow = sum(sells) - sum(buys) per condition
 * - liability = |negative_tokens| * resolution_price (for losing short positions)
 * - unredeemed_position_value = max(0, positive_tokens * resolution_price - redemptions)
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

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

async function calculatePnl(wallet: string): Promise<number> {
  // Get all trades with proper deduplication
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        sum(max_tokens) as total_tokens,
        sum(max_usdc) as total_usdc
      FROM (
        SELECT
          event_id,
          side,
          token_id,
          max(token_amount) / 1e6 as max_tokens,
          max(usdc_amount) / 1e6 as max_usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id, side, token_id
      ) t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NOT NULL
      GROUP BY m.condition_id, m.outcome_index, t.side
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  // Build condition data
  interface ConditionData {
    o0Buys: number; o0Sells: number; o0BuyUSDC: number; o0SellUSDC: number;
    o1Buys: number; o1Sells: number; o1BuyUSDC: number; o1SellUSDC: number;
  }

  const conditions = new Map<string, ConditionData>();

  for (const row of rows) {
    let c = conditions.get(row.condition_id);
    if (!c) {
      c = { o0Buys: 0, o0Sells: 0, o0BuyUSDC: 0, o0SellUSDC: 0,
            o1Buys: 0, o1Sells: 0, o1BuyUSDC: 0, o1SellUSDC: 0 };
      conditions.set(row.condition_id, c);
    }

    if (row.outcome_index === 0) {
      if (row.side === 'buy') { c.o0Buys = row.total_tokens; c.o0BuyUSDC = row.total_usdc; }
      else { c.o0Sells = row.total_tokens; c.o0SellUSDC = row.total_usdc; }
    } else {
      if (row.side === 'buy') { c.o1Buys = row.total_tokens; c.o1BuyUSDC = row.total_usdc; }
      else { c.o1Sells = row.total_tokens; c.o1SellUSDC = row.total_usdc; }
    }
  }

  // Get resolutions
  const conditionIds = Array.from(conditions.keys());
  if (conditionIds.length === 0) return 0;

  const idList = conditionIds.map(id => `'${id}'`).join(',');

  const resolutions = new Map<string, number[]>();
  const resResult = await clickhouse.query({
    query: `
      SELECT lower(condition_id) as condition_id, norm_prices
      FROM pm_condition_resolutions_norm
      WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
    `,
    format: 'JSONEachRow',
  });

  const resRows = await resResult.json() as { condition_id: string; norm_prices: number[] }[];
  for (const row of resRows) {
    resolutions.set(row.condition_id, row.norm_prices);
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(cid) as condition_id,
        sum(toFloat64OrZero(amount_or_payout))/1e6 as payout_amount
      FROM (
        SELECT lower(condition_id) as cid, amount_or_payout
        FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet.toLowerCase()}'
          AND event_type = 'PayoutRedemption'
          AND is_deleted = 0
      )
      GROUP BY cid
    `,
    format: 'JSONEachRow',
  });

  const redemptions = await redemptionResult.json() as any[];
  const redemptionByCondition = new Map<string, number>();
  for (const r of redemptions) {
    redemptionByCondition.set(r.condition_id, r.payout_amount);
  }

  // Calculate total PnL
  let totalPnl = 0;

  for (const [conditionId, c] of conditions) {
    const netO0 = c.o0Buys - c.o0Sells;
    const netO1 = c.o1Buys - c.o1Sells;
    const cashFlow = (c.o0SellUSDC - c.o0BuyUSDC) + (c.o1SellUSDC - c.o1BuyUSDC);

    const prices = resolutions.get(conditionId);
    const redemption = redemptionByCondition.get(conditionId) ?? 0;

    // Liability for negative positions
    let liability = 0;
    if (prices && netO0 < -0.01) liability += Math.abs(netO0) * prices[0];
    if (prices && netO1 < -0.01) liability += Math.abs(netO1) * prices[1];

    // Position value for positive positions (minus redemptions already received)
    let positionValue = 0;
    if (prices) {
      const totalPosValue = (netO0 > 0.01 ? netO0 * prices[0] : 0) + (netO1 > 0.01 ? netO1 * prices[1] : 0);
      positionValue = Math.max(0, totalPosValue - redemption);
    }

    totalPnl += cashFlow - liability + redemption + positionValue;
  }

  return totalPnl;
}

async function main() {
  // Test wallets from our earlier accuracy testing
  const testWallets = [
    '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb',  // Our debugging target
    '0xaa71c78c8e690bba54e6c1cd6d08b4e54b0b3afb',  // From V28 test
    '0xc16badd85f0c619dc2b1cc30f3cbe5e8f1a8a365',
    '0x5c38ceb5e29e78a1c8c8ff5e15f6c5e7d99f7d2e',
    '0x3d4f1e6a8c9b2d0e5f7a1c3b6d9e2f4a7b0c8d1e',
  ];

  console.log('\n=== PNL V29 - MULTI-WALLET TEST ===\n');
  console.log('wallet                                     | V29 PnL    | API PnL    | Diff       | %');
  console.log('-'.repeat(100));

  let matches = 0;
  let total = 0;

  for (const wallet of testWallets) {
    const [v29Pnl, apiPnl] = await Promise.all([
      calculatePnl(wallet),
      fetchApiPnl(wallet)
    ]);

    if (apiPnl !== null) {
      const diff = v29Pnl - apiPnl;
      const pctDiff = apiPnl !== 0 ? (diff / Math.abs(apiPnl)) * 100 : 0;
      const isMatch = Math.abs(pctDiff) < 10; // Within 10%

      console.log(
        `${wallet} | $${v29Pnl.toFixed(2).padStart(9)} | $${apiPnl.toFixed(2).padStart(9)} | $${diff.toFixed(2).padStart(9)} | ${pctDiff.toFixed(1)}%${isMatch ? ' ✓' : ''}`
      );

      if (isMatch) matches++;
      total++;
    } else {
      console.log(`${wallet} | $${v29Pnl.toFixed(2).padStart(9)} | API error  |            |`);
    }
  }

  console.log(`\nAccuracy: ${matches}/${total} (${((matches/total)*100).toFixed(0)}%) within 10%`);

  // Also test some random wallets
  console.log('\n=== RANDOM WALLET TEST ===\n');

  const randomResult = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const randomWallets = (await randomResult.json() as any[]).map(r => r.wallet);

  matches = 0;
  total = 0;

  for (const wallet of randomWallets) {
    const [v29Pnl, apiPnl] = await Promise.all([
      calculatePnl(wallet),
      fetchApiPnl(wallet)
    ]);

    if (apiPnl !== null) {
      const diff = v29Pnl - apiPnl;
      const pctDiff = apiPnl !== 0 ? (diff / Math.abs(apiPnl)) * 100 : 0;
      const isMatch = Math.abs(pctDiff) < 10;

      console.log(
        `${wallet} | $${v29Pnl.toFixed(2).padStart(9)} | $${apiPnl.toFixed(2).padStart(9)} | $${diff.toFixed(2).padStart(9)} | ${pctDiff.toFixed(1)}%${isMatch ? ' ✓' : ''}`
      );

      if (isMatch) matches++;
      total++;
    }
  }

  console.log(`\nRandom wallet accuracy: ${matches}/${total} (${total > 0 ? ((matches/total)*100).toFixed(0) : 0}%) within 10%`);

  process.exit(0);
}

main().catch(console.error);
