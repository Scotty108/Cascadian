/**
 * Quick test of trade metrics on 5 wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { computeTradeMetrics, aggregateWalletMetrics, RawTrade } from '../lib/wallet-intelligence/tradeMetrics';

async function main() {
  console.log('Testing trade metrics on 5 wallets...\n');

  // Get 5 test wallets
  const walletResult = await clickhouse.query({
    query: `SELECT wallet FROM pm_high_confidence_wallets LIMIT 5`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletResult.json() as Array<{ wallet: string }>).map(r => r.wallet);
  console.log('Test wallets:', wallets);

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
    // Parse payout_numerators - it's stored as "[1,0]" string
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

  const priceLookup = { getMidYesAt: () => null };

  for (const wallet of wallets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Wallet: ${wallet}`);

    // Get trades
    const tradeResult = await clickhouse.query({
      query: `
        SELECT event_id, trade_time, token_id, side,
               usdc_amount / 1e6 as usdc, token_amount / 1e6 as tokens, fee_amount / 1e6 as fee
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
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
        wallet,
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

    console.log(`Raw trades: ${rawTrades.length}`);

    if (rawTrades.length === 0) {
      console.log('No trades found');
      continue;
    }

    const tradeMetrics = computeTradeMetrics(rawTrades, resolutions, priceLookup);
    const aggregateMetrics = aggregateWalletMetrics(tradeMetrics);

    console.log('\nAggregate Metrics:');
    console.log(`  Total trades: ${aggregateMetrics.total_trades}`);
    console.log(`  Buy/Sell: ${aggregateMetrics.buy_trades}/${aggregateMetrics.sell_trades}`);
    console.log(`  Resolved: ${aggregateMetrics.resolved_trades}`);
    console.log(`  Total PnL: $${aggregateMetrics.total_pnl_usd.toFixed(2)}`);
    console.log(`  Win rate: ${(aggregateMetrics.win_rate * 100).toFixed(1)}%`);
    console.log(`  Avg ROI: ${(aggregateMetrics.avg_roi * 100).toFixed(1)}%`);
    console.log(`  Unique markets: ${aggregateMetrics.unique_markets}`);

    // Compare with Polymarket API
    try {
      const pmRes = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
      const pmData = await pmRes.json();
      if (Array.isArray(pmData) && pmData.length > 0) {
        const pmPnl = pmData[pmData.length - 1].p;
        const diff = Math.abs(aggregateMetrics.total_pnl_usd - pmPnl);
        const pct = Math.abs(pmPnl) > 0 ? (diff / Math.abs(pmPnl)) * 100 : 0;
        console.log(`\n  Polymarket PnL: $${pmPnl.toFixed(2)}`);
        console.log(`  Our PnL: $${aggregateMetrics.total_pnl_usd.toFixed(2)}`);
        console.log(`  Difference: $${diff.toFixed(2)} (${pct.toFixed(1)}%)`);
      }
    } catch {
      console.log('  Could not fetch Polymarket PnL');
    }
  }

  console.log('\n\nTest complete!');
}

main().catch(console.error);
