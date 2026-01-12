/**
 * PnL V30 - Using ALL Available Data (CLOB + CTF + Neg Risk Conversions)
 *
 * Data sources:
 * 1. pm_trader_events_v3 - CLOB trades
 * 2. pm_ctf_events - CTF events (splits, merges, redemptions)
 * 3. pm_neg_risk_conversions_v1 - Neg Risk conversion events
 * 4. pm_condition_resolutions_norm - Resolution payouts
 *
 * The key insight from Polymarket's subgraph:
 * - Splits: User pays $1, gets 1 YES + 1 NO (each recorded at $0.50 cost basis)
 * - Merges: User burns 1 YES + 1 NO, gets $1 (each sold at $0.50)
 * - Conversions: Burns NO positions, mints YES positions (synthetic pricing)
 * - CLOB: Regular buy/sell at market price
 * - Redemption: Winning positions pay $1, losing pay $0
 *
 * Formula:
 * PnL = (CLOB sells - CLOB buys) + (merge proceeds - split costs) + redemptions + unrealized
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

async function main() {
  const wallet = process.argv[2] || '0xd218e474776403a330142299f7796e8ba32eb5c9';

  console.log(`\n=== PNL V30 - FULL DATA FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);

  // 1. Get CLOB trades
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END) / 1e6 as total_buys,
        sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END) / 1e6 as total_sells,
        count() as trade_count
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
    `,
    format: 'JSONEachRow',
  });
  const clobRows = await clobResult.json() as any[];
  const clobBuys = clobRows[0]?.total_buys ?? 0;
  const clobSells = clobRows[0]?.total_sells ?? 0;
  const clobTradeCount = clobRows[0]?.trade_count ?? 0;

  console.log(`\n=== CLOB TRADES ===`);
  console.log(`Total buys: $${clobBuys.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total sells: $${clobSells.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Trade count: ${clobTradeCount}`);
  console.log(`Net CLOB: $${(clobSells - clobBuys).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // 2. Get CTF events (splits, merges, redemptions)
  const ctfResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      GROUP BY event_type
    `,
    format: 'JSONEachRow',
  });
  const ctfRows = await ctfResult.json() as any[];

  let splitCost = 0;
  let mergeProceeds = 0;
  let redemptions = 0;

  console.log(`\n=== CTF EVENTS ===`);
  for (const row of ctfRows) {
    console.log(`${row.event_type}: ${row.cnt} events, $${row.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    if (row.event_type === 'PositionSplit') splitCost = row.total_amount;
    else if (row.event_type === 'PositionsMerge') mergeProceeds = row.total_amount;
    else if (row.event_type === 'PayoutRedemption') redemptions = row.total_amount;
  }

  // 3. Get Neg Risk conversions
  const convResult = await clickhouse.query({
    query: `
      SELECT
        count() as cnt,
        sum(toFloat64OrZero(amount)) / 1e6 as total_amount
      FROM pm_neg_risk_conversions_v1
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const convRows = await convResult.json() as any[];
  const conversions = convRows[0]?.total_amount ?? 0;
  const conversionCount = convRows[0]?.cnt ?? 0;

  console.log(`\n=== NEG RISK CONVERSIONS ===`);
  console.log(`Conversions: ${conversionCount} events, ${conversions.toLocaleString('en-US', { minimumFractionDigits: 2 })} tokens converted`);

  // 4. Calculate PnL
  console.log(`\n=== PNL CALCULATION ===`);

  // Basic formula: PnL = CLOB net + CTF net + redemptions
  // CTF net = merges - splits (splits cost money, merges return money)
  const ctfNet = mergeProceeds - splitCost;
  const basicPnl = (clobSells - clobBuys) + ctfNet + redemptions;

  console.log(`CLOB net (sells - buys): $${(clobSells - clobBuys).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`CTF net (merges - splits): $${ctfNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Redemptions: $${redemptions.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Basic PnL: $${basicPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  console.log(`\n=== COMPARISON ===`);
  console.log(`Calculated PnL: $${basicPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`API PnL: $${apiPnl?.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? 'N/A'}`);
  if (apiPnl !== null) {
    const diff = basicPnl - apiPnl;
    const pctDiff = (diff / Math.abs(apiPnl)) * 100;
    console.log(`Difference: $${diff.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${pctDiff.toFixed(2)}%)`);
  }

  process.exit(0);
}

main().catch(console.error);
