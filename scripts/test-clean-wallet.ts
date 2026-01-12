/**
 * Test a truly CLOB-only wallet (no NEG_RISK interactions)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { computeTradeMetrics, aggregateWalletMetrics, RawTrade } from '../lib/wallet-intelligence/tradeMetricsV2';

async function main() {
  const testWallet = '0xd93d443d5c9fba0bc3a028b34ee5c051f8ca0095';
  console.log('Testing truly CLOB-only wallet:', testWallet);

  const tokenResult = await clickhouse.query({
    query: `SELECT token_id_dec, lower(condition_id) as condition_id, outcome_index FROM pm_token_to_condition_map_current`,
    format: 'JSONEachRow'
  });
  const tokenRows = await tokenResult.json() as Array<{ token_id_dec: string; condition_id: string; outcome_index: number }>;
  const tokenMap = new Map(tokenRows.map(r => [r.token_id_dec, { condition_id: r.condition_id, outcome_index: r.outcome_index }]));

  const resResult = await clickhouse.query({
    query: `SELECT lower(condition_id) as condition_id, resolved_at, payout_numerators FROM pm_condition_resolutions WHERE is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const resRows = await resResult.json() as Array<{ condition_id: string; resolved_at: string; payout_numerators: string }>;
  const resolutions = new Map(resRows.map(r => {
    let payoutYes = 0;
    try { payoutYes = JSON.parse(r.payout_numerators)[0] || 0; } catch {}
    return [r.condition_id, { resolved_at: new Date(r.resolved_at), outcome_yes: (payoutYes > 0 ? 1 : 0) as 0 | 1 }];
  }));

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

  console.log(`Trades: ${rawTrades.length}`);

  // Check buy/sell balance per token
  const tokenBalances = new Map<string, { bought: number; sold: number }>();
  for (const t of rawTrades) {
    const key = t.token_id;
    const bal = tokenBalances.get(key) || { bought: 0, sold: 0 };
    if (t.action === 'BUY') bal.bought += t.qty;
    else bal.sold += t.qty;
    tokenBalances.set(key, bal);
  }

  const oversoldTokens = [...tokenBalances.entries()].filter(([_, b]) => b.sold > b.bought + 0.01);
  console.log(`\nTokens with more sells than buys: ${oversoldTokens.length}`);
  if (oversoldTokens.length > 0) {
    console.log('WARNING: This wallet has sells without buys, not truly CLOB-only');
    for (const [tokenId, bal] of oversoldTokens.slice(0, 3)) {
      console.log(`  ${tokenId.slice(0, 20)}...: bought ${bal.bought.toFixed(2)}, sold ${bal.sold.toFixed(2)}`);
    }
  }

  const priceLookup = { getMidYesAt: () => null };
  const v2Trades = computeTradeMetrics(rawTrades, resolutions, priceLookup);
  const v2Metrics = aggregateWalletMetrics(v2Trades);

  let pmPnl: number | null = null;
  try {
    const pmRes = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${testWallet}`);
    const pmData = await pmRes.json();
    if (Array.isArray(pmData) && pmData.length > 0) pmPnl = pmData[pmData.length - 1].p;
  } catch {}

  console.log('\n=== RESULTS ===');
  console.log(`Our PnL (V2): $${v2Metrics.total_pnl_usd.toFixed(2)}`);
  console.log(`Polymarket PnL: ${pmPnl !== null ? '$' + pmPnl.toFixed(2) : 'N/A'}`);
  if (pmPnl !== null) {
    const error = Math.abs(v2Metrics.total_pnl_usd - pmPnl);
    const errorPct = Math.abs(pmPnl) > 0 ? (error / Math.abs(pmPnl)) * 100 : 0;
    console.log(`Error: $${error.toFixed(2)} (${errorPct.toFixed(1)}%)`);
    console.log(errorPct < 10 ? '✅ GOOD ACCURACY' : '❌ POOR ACCURACY');
  }
}

main().catch(console.error);
