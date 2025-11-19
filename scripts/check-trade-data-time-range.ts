#!/usr/bin/env npx tsx
/**
 * Check Trade Data Time Range
 * Determine if we have full history or just June-Nov 2024
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n📅 TRADE DATA TIME RANGE CHECK\n');
  console.log('═'.repeat(80));

  // 1. Overall time range
  console.log('\n1️⃣ Overall time range in fact_trades_clean:\n');

  const timeRange = await ch.query({
    query: `
      SELECT
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade,
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as unique_wallets,
        COUNT(DISTINCT cid) as unique_markets
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });

  const rangeData = await timeRange.json<any>();
  console.log(`  Earliest trade: ${rangeData[0].earliest_trade}`);
  console.log(`  Latest trade: ${rangeData[0].latest_trade}`);
  console.log(`  Total trades: ${parseInt(rangeData[0].total_trades).toLocaleString()}`);
  console.log(`  Unique wallets: ${parseInt(rangeData[0].unique_wallets).toLocaleString()}`);
  console.log(`  Unique markets: ${parseInt(rangeData[0].unique_markets).toLocaleString()}\n`);

  // 2. Trades by month
  console.log('2️⃣ Trade distribution by month:\n');

  const byMonth = await ch.query({
    query: `
      SELECT
        toYYYYMM(block_time) as month,
        COUNT(*) as trades,
        COUNT(DISTINCT wallet_address) as wallets,
        COUNT(DISTINCT cid) as markets
      FROM default.fact_trades_clean
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });

  const monthData = await byMonth.json<any>();
  console.log('  Month      | Trades      | Wallets   | Markets');
  console.log('  -----------|-------------|-----------|----------');
  monthData.forEach((row: any) => {
    const monthStr = row.month.toString();
    const year = monthStr.substring(0, 4);
    const month = monthStr.substring(4, 6);
    console.log(`  ${year}-${month}    | ${parseInt(row.trades).toLocaleString().padStart(11)} | ${parseInt(row.wallets).toLocaleString().padStart(9)} | ${parseInt(row.markets).toLocaleString().padStart(8)}`);
  });

  // 3. Check specific wallet 0x4ce7
  console.log('\n3️⃣ Wallet 0x4ce7 trade history:\n');

  const wallet0x4ce7 = await ch.query({
    query: `
      SELECT
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade,
        COUNT(*) as total_trades,
        COUNT(DISTINCT cid) as unique_markets
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow'
  });

  const walletData = await wallet0x4ce7.json<any>();

  if (walletData[0].total_trades > 0) {
    console.log(`  First trade: ${walletData[0].first_trade}`);
    console.log(`  Last trade: ${walletData[0].last_trade}`);
    console.log(`  Total trades: ${parseInt(walletData[0].total_trades).toLocaleString()}`);
    console.log(`  Unique markets: ${parseInt(walletData[0].unique_markets).toLocaleString()}\n`);
  } else {
    console.log('  ⚠️  Wallet not found in fact_trades_clean\n');
  }

  // 4. Sample oldest trades to verify
  console.log('4️⃣ Sample of oldest trades:\n');

  const oldestTrades = await ch.query({
    query: `
      SELECT
        block_time,
        wallet_address,
        cid
      FROM default.fact_trades_clean
      ORDER BY block_time ASC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const oldestData = await oldestTrades.json<any>();
  oldestData.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. ${row.block_time} | ${row.wallet_address.substring(0, 10)}... | ${row.cid.substring(0, 16)}...`);
  });

  console.log('\n═'.repeat(80));
  console.log('📊 DIAGNOSIS\n');

  const earliest = new Date(rangeData[0].earliest_trade);
  const latest = new Date(rangeData[0].latest_trade);
  const daysCovered = Math.floor((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`Time range: ${earliest.toISOString().split('T')[0]} to ${latest.toISOString().split('T')[0]}`);
  console.log(`Days covered: ${daysCovered} days\n`);

  if (daysCovered < 180) {
    console.log('❌ LIMITED HISTORY DETECTED');
    console.log('   - Less than 6 months of data');
    console.log('   - Missing historical trades\n');
    console.log('To get wallet 0x4ce7\'s full 2,800 trades:');
    console.log('   Need to backfill pre-' + earliest.toISOString().split('T')[0] + ' trades\n');
  } else if (daysCovered < 365) {
    console.log('⚠️  PARTIAL HISTORY');
    console.log('   - 6-12 months of data');
    console.log('   - Some historical data missing\n');
  } else {
    console.log('✅ FULL HISTORY');
    console.log('   - 1+ years of data');
    console.log('   - Should have complete wallet histories\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
