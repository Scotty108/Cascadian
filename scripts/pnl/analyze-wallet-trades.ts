#!/usr/bin/env npx tsx
/**
 * Analyze individual trade flow for a wallet
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function main() {
  const wallet = process.argv[2] || '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191';

  console.log('=== Trade Analysis for wallet ===');
  console.log(`Wallet: ${wallet}\n`);

  // Get all trades
  const trades = await clickhouse.query({
    query: `
      SELECT
        event_id,
        trade_time,
        token_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as shares,
        fee_amount / 1e6 as fee
      FROM (
        SELECT event_id, any(trade_time) as trade_time, any(token_id) as token_id,
               any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(fee_amount) as fee_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet:String}
          AND is_deleted = 0
        GROUP BY event_id
      )
      ORDER BY trade_time
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow'
  });
  const tradeRows = await trades.json() as any[];

  // Group by token_id
  const byToken = new Map<string, any[]>();
  for (const t of tradeRows) {
    const existing = byToken.get(t.token_id);
    if (existing) {
      existing.push(t);
    } else {
      byToken.set(t.token_id, [t]);
    }
  }

  console.log(`Found ${tradeRows.length} trades across ${byToken.size} tokens\n`);

  let totalRealized = 0;
  let totalUnrealizedBasis = 0;

  for (const [tokenId, tokenTrades] of byToken.entries()) {
    console.log(`\n--- Token: ${tokenId.slice(0, 40)}... ---`);

    let shares = 0;
    let basis = 0;
    let realized = 0;

    for (const t of tokenTrades) {
      if (t.side === 'buy') {
        shares += t.shares;
        basis += t.usdc;
        console.log(`  BUY  ${t.shares.toFixed(2).padStart(10)} @ $${(t.usdc/t.shares).toFixed(4)} = $${t.usdc.toFixed(2).padStart(8)} | inv: ${shares.toFixed(2)} shares, $${basis.toFixed(2)} basis`);
      } else {
        const avgCost = shares > 0 ? basis / shares : 0;
        const basisSold = avgCost * t.shares;
        const pnl = t.usdc - basisSold;
        realized += pnl;
        shares -= t.shares;
        basis -= basisSold;
        console.log(`  SELL ${t.shares.toFixed(2).padStart(10)} @ $${(t.usdc/t.shares).toFixed(4)} = $${t.usdc.toFixed(2).padStart(8)} | pnl: $${pnl.toFixed(2).padStart(8)} | inv: ${shares.toFixed(2)} shares, $${basis.toFixed(2)} basis`);
      }
    }

    console.log(`  FINAL: ${shares.toFixed(2)} shares remaining, $${basis.toFixed(2)} unrealized basis, $${realized.toFixed(2)} trading realized`);
    totalRealized += realized;
    totalUnrealizedBasis += basis;
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Trading Realized PnL: $${totalRealized.toFixed(2)}`);
  console.log(`Total Unrealized Basis (still held): $${totalUnrealizedBasis.toFixed(2)}`);
  console.log('\nNote: This does NOT include settlements/redemptions. If wallet has resolved');
  console.log('positions, the final PnL will differ from this trading-only calculation.');

  await clickhouse.close();
}

main().catch(console.error);
