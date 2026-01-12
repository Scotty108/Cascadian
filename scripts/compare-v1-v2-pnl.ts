/**
 * Compare V1 (buggy) vs V2 (fixed) PnL calculations against Polymarket API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { computeTradeMetrics as computeV1, aggregateWalletMetrics as aggregateV1, RawTrade } from '../lib/wallet-intelligence/tradeMetrics';
import { computeTradeMetrics as computeV2, aggregateWalletMetrics as aggregateV2 } from '../lib/wallet-intelligence/tradeMetricsV2';

async function main() {
  const testWallet = '0x0015c5a76490d303e837d79dd5cf6a3825e4d5b0';

  console.log('Loading data for wallet:', testWallet);

  // Get token mapping
  const tokenResult = await clickhouse.query({
    query: `SELECT token_id_dec, lower(condition_id) as condition_id, outcome_index FROM pm_token_to_condition_map_current`,
    format: 'JSONEachRow'
  });
  const tokenRows = await tokenResult.json() as Array<{ token_id_dec: string; condition_id: string; outcome_index: number }>;
  const tokenMap = new Map(tokenRows.map(r => [r.token_id_dec, { condition_id: r.condition_id, outcome_index: r.outcome_index }]));
  console.log(`Loaded ${tokenMap.size} token mappings`);

  // Get resolutions
  const resResult = await clickhouse.query({
    query: `SELECT lower(condition_id) as condition_id, resolved_at, payout_numerators FROM pm_condition_resolutions WHERE is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const resRows = await resResult.json() as Array<{ condition_id: string; resolved_at: string; payout_numerators: string }>;
  const resolutions = new Map(resRows.map(r => {
    let payoutYes = 0;
    try {
      const arr = JSON.parse(r.payout_numerators);
      payoutYes = arr[0] || 0;
    } catch {}
    return [
      r.condition_id,
      { resolved_at: new Date(r.resolved_at), outcome_yes: (payoutYes > 0 ? 1 : 0) as 0 | 1 }
    ];
  }));
  console.log(`Loaded ${resolutions.size} resolutions`);

  // Get trades
  const tradeResult = await clickhouse.query({
    query: `
      SELECT event_id, trade_time, token_id, side,
             usdc_amount / 1e6 as usdc, token_amount / 1e6 as tokens, fee_amount / 1e6 as fee
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${testWallet.toLowerCase()}'
      ORDER BY trade_time
    `,
    format: 'JSONEachRow'
  });
  const tradeRows = await tradeResult.json() as Array<{
    event_id: string; trade_time: string; token_id: string; side: string;
    usdc: number; tokens: number; fee: number;
  }>;

  const rawTrades: RawTrade[] = [];
  for (const r of tradeRows) {
    const mapping = tokenMap.get(r.token_id);
    if (!mapping) continue;
    rawTrades.push({
      trade_id: r.event_id,
      ts: new Date(r.trade_time),
      wallet: testWallet,
      condition_id: mapping.condition_id,
      token_id: r.token_id,
      outcome_index: mapping.outcome_index,
      side: mapping.outcome_index === 0 ? 'YES' : 'NO',
      action: r.side === 'buy' ? 'BUY' : 'SELL',
      price_yes: r.tokens > 0 ? r.usdc / r.tokens : 0,
      qty: r.tokens,
      notional_usd: r.usdc,
      fee_usd: r.fee,
    });
  }

  console.log(`\nProcessing ${rawTrades.length} trades...\n`);

  const priceLookup = { getMidYesAt: () => null };

  // Compute V1 (buggy)
  const v1Trades = computeV1(rawTrades, resolutions, priceLookup);
  const v1Metrics = aggregateV1(v1Trades);

  // Compute V2 (fixed)
  const v2Trades = computeV2(rawTrades, resolutions, priceLookup);
  const v2Metrics = aggregateV2(v2Trades);

  // Get Polymarket API PnL
  let pmPnl: number | null = null;
  try {
    const pmRes = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${testWallet}`);
    const pmData = await pmRes.json();
    if (Array.isArray(pmData) && pmData.length > 0) {
      pmPnl = pmData[pmData.length - 1].p;
    }
  } catch {}

  console.log('='.repeat(60));
  console.log('COMPARISON: V1 (buggy) vs V2 (fixed) vs Polymarket');
  console.log('='.repeat(60));
  console.log(`\nWallet: ${testWallet}`);
  console.log(`Total trades: ${rawTrades.length}`);
  console.log(`\n${'Metric'.padEnd(25)} | ${'V1 (buggy)'.padEnd(15)} | ${'V2 (fixed)'.padEnd(15)} | ${'Polymarket'.padEnd(15)}`);
  console.log('-'.repeat(75));
  console.log(`${'Total PnL'.padEnd(25)} | ${'$' + v1Metrics.total_pnl_usd.toFixed(2).padEnd(14)} | ${'$' + v2Metrics.total_pnl_usd.toFixed(2).padEnd(14)} | ${pmPnl ? '$' + pmPnl.toFixed(2) : 'N/A'}`);

  if (pmPnl) {
    const v1Error = Math.abs(v1Metrics.total_pnl_usd - pmPnl);
    const v2Error = Math.abs(v2Metrics.total_pnl_usd - pmPnl);
    const v1ErrorPct = Math.abs(pmPnl) > 0 ? (v1Error / Math.abs(pmPnl)) * 100 : 0;
    const v2ErrorPct = Math.abs(pmPnl) > 0 ? (v2Error / Math.abs(pmPnl)) * 100 : 0;

    console.log(`${'Error vs PM'.padEnd(25)} | ${'$' + v1Error.toFixed(2) + ' (' + v1ErrorPct.toFixed(0) + '%)'.padEnd(14)} | ${'$' + v2Error.toFixed(2) + ' (' + v2ErrorPct.toFixed(0) + '%)'.padEnd(14)} | -`);
    console.log(`\nV1 Error: ${v1ErrorPct.toFixed(1)}%`);
    console.log(`V2 Error: ${v2ErrorPct.toFixed(1)}%`);
    console.log(`Improvement: ${((v1Error - v2Error) / v1Error * 100).toFixed(1)}% reduction in error`);
  }

  // Show some statistics about sells vs resolutions
  const sellCount = rawTrades.filter(t => t.action === 'SELL').length;
  const buyCount = rawTrades.filter(t => t.action === 'BUY').length;

  // Check how many buys have remaining inventory in V2
  const buysWithRemaining = v2Trades.filter(t => t.action === 'BUY' && t.qty_remaining > 0).length;
  const buysFullySold = v2Trades.filter(t => t.action === 'BUY' && t.qty_remaining === 0).length;

  console.log(`\nTrade breakdown:`);
  console.log(`  BUY trades: ${buyCount}`);
  console.log(`  SELL trades: ${sellCount}`);
  console.log(`  BUYs with remaining inventory: ${buysWithRemaining}`);
  console.log(`  BUYs fully sold before resolution: ${buysFullySold}`);
}

main().catch(console.error);
