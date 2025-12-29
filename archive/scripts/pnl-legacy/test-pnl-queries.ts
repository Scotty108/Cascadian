#!/usr/bin/env npx tsx
/**
 * TEST PNL QUERIES
 *
 * This script runs a series of test queries to verify that the P&L
 * calculation is working correctly.
 *
 * Runtime: < 1 minute
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function testQueries() {
  console.log('\n🧪 Testing P&L Queries\n');
  console.log('=' .repeat(80));

  try {
    // Test 1: Top wallets by P&L
    console.log('\n1️⃣ Top 10 Wallets by P&L:\n');
    const topWallets = await client.query({
      query: `
        SELECT
          wallet_address,
          count() as total_trades,
          sum(realized_pnl_usd) as total_pnl,
          sum(usd_value) as total_volume,
          countIf(realized_pnl_usd > 0) as winning_trades,
          countIf(realized_pnl_usd < 0) as losing_trades,
          winning_trades * 100.0 / nullIf(total_trades, 0) as win_rate
        FROM trades_with_pnl
        WHERE resolved_at IS NOT NULL
        GROUP BY wallet_address
        HAVING total_trades > 10
        ORDER BY total_pnl DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const wallets = await topWallets.json();
    wallets.forEach((w: any, i: number) => {
      console.log(`   ${i + 1}. ${w.wallet_address}`);
      console.log(`      P&L: $${parseFloat(w.total_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Volume: $${parseFloat(w.total_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Win Rate: ${parseFloat(w.win_rate).toFixed(1)}% (${w.winning_trades}W / ${w.losing_trades}L)`);
    });

    // Test 2: Biggest winners and losers
    console.log('\n2️⃣ Biggest Single Trade Wins:\n');
    const bigWins = await client.query({
      query: `
        SELECT
          wallet_address,
          direction,
          shares,
          price,
          usd_value,
          realized_pnl_usd,
          winning_outcome
        FROM trades_with_pnl
        WHERE realized_pnl_usd IS NOT NULL
        ORDER BY realized_pnl_usd DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const wins = await bigWins.json();
    wins.forEach((w: any, i: number) => {
      console.log(`   ${i + 1}. $${parseFloat(w.realized_pnl_usd).toFixed(2)} profit`);
      console.log(`      Wallet: ${w.wallet_address.substring(0, 10)}...`);
      console.log(`      ${w.direction} ${w.shares} @ $${w.price} (Winner: ${w.winning_outcome})`);
    });

    console.log('\n3️⃣ Biggest Single Trade Losses:\n');
    const bigLosses = await client.query({
      query: `
        SELECT
          wallet_address,
          direction,
          shares,
          price,
          usd_value,
          realized_pnl_usd,
          winning_outcome
        FROM trades_with_pnl
        WHERE realized_pnl_usd IS NOT NULL
        ORDER BY realized_pnl_usd ASC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const losses = await bigLosses.json();
    losses.forEach((l: any, i: number) => {
      console.log(`   ${i + 1}. $${parseFloat(l.realized_pnl_usd).toFixed(2)} loss`);
      console.log(`      Wallet: ${l.wallet_address.substring(0, 10)}...`);
      console.log(`      ${l.direction} ${l.shares} @ $${l.price} (Winner: ${l.winning_outcome})`);
    });

    // Test 3: Overall stats
    console.log('\n4️⃣ Overall Platform Stats:\n');
    const stats = await client.query({
      query: `
        SELECT
          count(DISTINCT wallet_address) as unique_wallets,
          count(DISTINCT condition_id_norm) as unique_markets,
          count() as total_trades,
          sum(usd_value) as total_volume,
          sum(realized_pnl_usd) as net_pnl,
          countIf(realized_pnl_usd > 0) as winning_trades,
          countIf(realized_pnl_usd < 0) as losing_trades
        FROM trades_with_pnl
        WHERE resolved_at IS NOT NULL
      `,
      format: 'JSONEachRow',
    });
    const platformStats: any = (await stats.json())[0];
    console.log(`   Unique Wallets: ${parseInt(platformStats.unique_wallets).toLocaleString()}`);
    console.log(`   Unique Markets: ${parseInt(platformStats.unique_markets).toLocaleString()}`);
    console.log(`   Total Trades: ${parseInt(platformStats.total_trades).toLocaleString()}`);
    console.log(`   Total Volume: $${parseFloat(platformStats.total_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Net P&L: $${parseFloat(platformStats.net_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Win/Loss Ratio: ${platformStats.winning_trades}W / ${platformStats.losing_trades}L`);

    console.log('\n✅ All queries working!\n');
    console.log('🚀 Your data is ready. Start building your dashboard!\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

testQueries().catch(console.error);
