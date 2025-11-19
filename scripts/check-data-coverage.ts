#!/usr/bin/env npx tsx
/**
 * Check Data Coverage in trades_raw
 * Critical: Determine if we have full historical data or only recent (2024+)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('DATA COVERAGE ANALYSIS');
  console.log('═'.repeat(100) + '\n');

  // Overall coverage
  console.log('1️⃣  Overall Data Coverage\n');
  const overallQuery = `
    SELECT
      min(block_time) as earliest_trade,
      max(block_time) as latest_trade,
      dateDiff('day', min(block_time), max(block_time)) as days_coverage,
      count(*) as total_trades
    FROM default.trades_raw
    WHERE condition_id NOT LIKE '%token_%'
  `;

  const overallResult = await ch.query({ query: overallQuery, format: 'JSONEachRow' });
  const overallData = await overallResult.json<any[]>();

  if (overallData.length > 0) {
    const data = overallData[0];
    console.log(`   Earliest Trade: ${data.earliest_trade}`);
    console.log(`   Latest Trade:   ${data.latest_trade}`);
    console.log(`   Coverage:       ${data.days_coverage} days`);
    console.log(`   Total Trades:   ${parseInt(data.total_trades).toLocaleString()}\n`);
  }

  // Baseline wallet (matches Polymarket)
  console.log('2️⃣  Baseline Wallet Coverage (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b)\n');
  const baselineQuery = `
    SELECT
      min(block_time) as earliest_trade,
      max(block_time) as latest_trade,
      dateDiff('day', min(block_time), max(block_time)) as days_active,
      count(*) as num_trades
    FROM default.trades_raw
    WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      AND condition_id NOT LIKE '%token_%'
  `;

  const baselineResult = await ch.query({ query: baselineQuery, format: 'JSONEachRow' });
  const baselineData = await baselineResult.json<any[]>();

  if (baselineData.length > 0) {
    const data = baselineData[0];
    console.log(`   Earliest Trade: ${data.earliest_trade}`);
    console.log(`   Latest Trade:   ${data.latest_trade}`);
    console.log(`   Active Period:  ${data.days_active} days`);
    console.log(`   Num Trades:     ${parseInt(data.num_trades).toLocaleString()}\n`);
  }

  // High-deviation wallet
  console.log('3️⃣  High-Deviation Wallet Coverage (0x7f3c8979d0afa00007bae4747d5347122af05613)\n');
  const deviationQuery = `
    SELECT
      min(block_time) as earliest_trade,
      max(block_time) as latest_trade,
      dateDiff('day', min(block_time), max(block_time)) as days_active,
      count(*) as num_trades
    FROM default.trades_raw
    WHERE lower(wallet) = '0x7f3c8979d0afa00007bae4747d5347122af05613'
      AND condition_id NOT LIKE '%token_%'
  `;

  const deviationResult = await ch.query({ query: deviationQuery, format: 'JSONEachRow' });
  const deviationData = await deviationResult.json<any[]>();

  if (deviationData.length > 0) {
    const data = deviationData[0];
    console.log(`   Earliest Trade: ${data.earliest_trade}`);
    console.log(`   Latest Trade:   ${data.latest_trade}`);
    console.log(`   Active Period:  ${data.days_active} days`);
    console.log(`   Num Trades:     ${parseInt(data.num_trades).toLocaleString()}\n`);
  }

  // Check all 14 benchmark wallets
  console.log('4️⃣  All Benchmark Wallets - First Trade Date\n');

  const benchmarkWallets = [
    '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
    '0x662244931c392df70bd064fa91f838eea0bfd7a9',
    '0x2e0b70d482e6b389e81dea528be57d825dd48070',
    '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
    '0xd748c701ad93cfec32a3420e10f3b08e68612125',
    '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397',
    '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
    '0x7f3c8979d0afa00007bae4747d5347122af05613',
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
  ];

  console.log(`   ${'Wallet'.padEnd(44)} | First Trade    | Trades`);
  console.log(`   ${'-'.repeat(70)}`);

  for (const wallet of benchmarkWallets) {
    const walletQuery = `
      SELECT
        min(block_time) as earliest_trade,
        count(*) as num_trades
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
        AND condition_id NOT LIKE '%token_%'
    `;

    const walletResult = await ch.query({ query: walletQuery, format: 'JSONEachRow' });
    const walletData = await walletResult.json<any[]>();

    if (walletData.length > 0 && walletData[0].earliest_trade) {
      const data = walletData[0];
      const shortWallet = wallet.substring(0, 10) + '...';
      console.log(`   ${shortWallet.padEnd(44)} | ${data.earliest_trade} | ${parseInt(data.num_trades).toLocaleString()}`);
    } else {
      const shortWallet = wallet.substring(0, 10) + '...';
      console.log(`   ${shortWallet.padEnd(44)} | NO DATA        | 0`);
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('ANALYSIS');
  console.log('═'.repeat(100));

  if (overallData.length > 0) {
    const earliest = new Date(overallData[0].earliest_trade);
    const earliestYear = earliest.getFullYear();

    console.log(`\nOur data starts: ${overallData[0].earliest_trade}`);

    if (earliestYear >= 2024) {
      console.log(`\n🚨 CRITICAL: Data only goes back to ${earliestYear}`);
      console.log(`   This means we are missing historical data!`);
      console.log(`   Benchmark wallets with pre-2024 activity will show WRONG lifetime P&L`);
      console.log(`\n   RECOMMENDATION: Do NOT compare "lifetime" values`);
      console.log(`   Either get historical data OR only use 2024-present windows\n`);
    } else {
      console.log(`\n✅ Good: Data goes back to ${earliestYear}`);
      console.log(`   We have historical coverage for lifetime P&L calculations\n`);
    }
  }

  await ch.close();
}

main().catch(console.error);
