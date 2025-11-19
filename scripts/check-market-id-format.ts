#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 Checking what market_ids actually look like...\n');

  // Get sample market_ids for this wallet
  const samplesResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        market_id,
        condition_id,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        block_time,
        count() OVER (PARTITION BY market_id) as trade_count
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
      ORDER BY trade_count DESC, block_time DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samples = await samplesResult.json<Array<any>>();

  console.log(`Sample market_ids for wallet ${wallet.substring(0, 10)}...:\n`);
  samples.forEach((s, i) => {
    console.log(`${i+1}. Market ID: ${s.market_id}`);
    console.log(`   Condition: ${s.condition_id_norm.substring(0, 16)}...`);
    console.log(`   Time: ${s.block_time}`);
    console.log(`   Trades: ${s.trade_count}\n`);
  });

  // Check date range
  console.log('\n━━━ Date Range for This Wallet ━━━\n');
  const dateResult = await clickhouse.query({
    query: `
      SELECT
        min(block_time) as first_trade,
        max(block_time) as last_trade,
        count() as total_trades
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const dates = await dateResult.json<Array<any>>();
  console.log(`First trade: ${dates[0].first_trade}`);
  console.log(`Last trade: ${dates[0].last_trade}`);
  console.log(`Total trades: ${dates[0].total_trades}`);

  // Check if we have markets from Aug-Nov 2024
  console.log('\n━━━ Database Coverage for Aug-Nov 2024 ━━━\n');
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(block_time) as month,
        count() as trades,
        uniqExact(lower(wallet)) as unique_wallets,
        uniqExact(market_id) as unique_markets
      FROM default.trades_raw
      WHERE block_time >= '2024-08-01' AND block_time < '2024-12-01'
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageResult.json<Array<any>>();
  coverage.forEach(c => {
    console.log(`${c.month}: ${parseInt(c.trades).toLocaleString()} trades, ${parseInt(c.unique_wallets).toLocaleString()} wallets, ${parseInt(c.unique_markets).toLocaleString()} markets`);
  });
}

main().catch(console.error);
