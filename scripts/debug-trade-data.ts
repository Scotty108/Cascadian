#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('DEBUG: TRADE DATA INSPECTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check wallet 0xb48e... which has the best match
  const wallet = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

  console.log(`Checking wallet: ${wallet}`);
  console.log('');

  // Get summary stats
  const summary = await ch.query({
    query: `
      SELECT
        count(*) AS total_trades,
        countIf(trade_direction = 'BUY') AS buys,
        countIf(trade_direction = 'SELL') AS sells,
        sum(if(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS total_buy_usd,
        sum(if(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS total_sell_usd,
        sum(if(trade_direction = 'BUY', toFloat64(shares), 0)) AS total_buy_shares,
        sum(if(trade_direction = 'SELL', toFloat64(shares), 0)) AS total_sell_shares
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });

  const stats = await summary.json<any[]>();
  if (stats.length > 0) {
    const s = stats[0];
    console.log('SUMMARY:');
    console.log(`  Total trades: ${s.total_trades}`);
    console.log(`  Buys:  ${s.buys} (${parseFloat(s.total_buy_shares).toFixed(2)} shares, $${parseFloat(s.total_buy_usd).toFixed(2)})`);
    console.log(`  Sells: ${s.sells} (${parseFloat(s.total_sell_shares).toFixed(2)} shares, $${parseFloat(s.total_sell_usd).toFixed(2)})`);
    console.log('');

    const netCash = parseFloat(s.total_sell_usd) - parseFloat(s.total_buy_usd);
    const netShares = parseFloat(s.total_buy_shares) - parseFloat(s.total_sell_shares);

    console.log('NET:');
    console.log(`  Cash: $${netCash.toFixed(2)} (sell - buy)`);
    console.log(`  Shares: ${netShares.toFixed(2)} (buy - sell)`);
    console.log('');

    console.log('POLYMARKET COMPARISON:');
    console.log(`  Polymarket P&L: $114,087`);
    console.log(`  Our net cash:   $${netCash.toFixed(0)}`);
    console.log(`  Difference:     $${(netCash - 114087).toFixed(0)}`);
    console.log('');
  }

  // Sample a few trades to inspect the data
  console.log('SAMPLE TRADES:');
  console.log('─'.repeat(80));

  const sample = await ch.query({
    query: `
      SELECT
        timestamp,
        trade_direction,
        shares,
        price,
        usd_value,
        condition_id_norm,
        outcome_index
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${wallet}')
      ORDER BY timestamp DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const trades = await sample.json<any[]>();
  for (const t of trades) {
    console.log(`${t.timestamp} | ${t.trade_direction.padEnd(4)} | Shares: ${parseFloat(t.shares).toFixed(4)} | Price: ${parseFloat(t.price).toFixed(4)} | USD: $${parseFloat(t.usd_value).toFixed(2)}`);
  }

  console.log('');

  // Check what d_cash looks like in our view
  console.log('D_CASH CALCULATION CHECK:');
  console.log('─'.repeat(80));

  const dcash = await ch.query({
    query: `
      SELECT
        sum(d_cash) AS total_d_cash,
        sum(if(d_cash > 0, d_cash, 0)) AS positive_d_cash,
        sum(if(d_cash < 0, d_cash, 0)) AS negative_d_cash
      FROM cascadian_clean.vw_trades_ledger
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });

  const dcashData = await dcash.json<any[]>();
  if (dcashData.length > 0) {
    const d = dcashData[0];
    console.log(`Total d_cash: $${parseFloat(d.total_d_cash).toFixed(2)}`);
    console.log(`Positive (sells): $${parseFloat(d.positive_d_cash).toFixed(2)}`);
    console.log(`Negative (buys): $${parseFloat(d.negative_d_cash).toFixed(2)}`);
    console.log('');
  }

  await ch.close();
}

main().catch(console.error);
