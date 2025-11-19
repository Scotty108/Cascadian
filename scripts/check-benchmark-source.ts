#!/usr/bin/env npx tsx
/**
 * Check if benchmark targets came from trades_raw (old method)
 * Compare benchmark targets against both trades_raw and trade_cashflows_v3
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

// Test a few wallets with extreme deviations
const TEST_WALLETS = [
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', target: 179243 },
  { wallet: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', target: 124705 },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', target: 94730 }
];

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('BENCHMARK SOURCE INVESTIGATION');
  console.log('═'.repeat(100) + '\n');

  console.log('Testing if benchmark targets came from trades_raw (old broken method)...\n');

  for (const test of TEST_WALLETS) {
    console.log(`Wallet: ${test.wallet}`);
    console.log(`Benchmark Target: $${test.target.toLocaleString()}\n`);

    // Query trades_raw (old method)
    const tradesRawQuery = `
      SELECT
        sum(toFloat64(cashflow_usdc)) as net_pnl,
        count() as num_trades
      FROM default.trades_raw
      WHERE lower(wallet) = '${test.wallet}'
        AND condition_id NOT LIKE '%token_%'
    `;

    const tradesRawResult = await ch.query({ query: tradesRawQuery, format: 'JSONEachRow' });
    const tradesRawData = await tradesRawResult.json<any[]>();

    // Query trade_cashflows_v3 (canonical)
    const cashflowsQuery = `
      SELECT
        sum(toFloat64(cashflow_usdc)) as net_pnl,
        count() as num_entries
      FROM default.trade_cashflows_v3
      WHERE lower(wallet) = '${test.wallet}'
    `;

    const cashflowsResult = await ch.query({ query: cashflowsQuery, format: 'JSONEachRow' });
    const cashflowsData = await cashflowsResult.json<any[]>();

    const tradesRawPnl = tradesRawData.length > 0 ? parseFloat(tradesRawData[0].net_pnl) : 0;
    const cashflowsPnl = cashflowsData.length > 0 ? parseFloat(cashflowsData[0].net_pnl) : 0;

    const tradesRawDiff = Math.abs(tradesRawPnl - test.target);
    const cashflowsDiff = Math.abs(cashflowsPnl - test.target);

    console.log(`  trades_raw (OLD):        $${Math.round(tradesRawPnl).toLocaleString()}`);
    console.log(`  trade_cashflows_v3 (NEW): $${Math.round(cashflowsPnl).toLocaleString()}`);
    console.log(`  Benchmark Target:         $${test.target.toLocaleString()}`);
    console.log(`\n  Difference from target:`);
    console.log(`    trades_raw:        $${Math.round(tradesRawDiff).toLocaleString()} ${tradesRawDiff < cashflowsDiff ? '✅ CLOSER' : ''}`);
    console.log(`    trade_cashflows_v3: $${Math.round(cashflowsDiff).toLocaleString()} ${cashflowsDiff < tradesRawDiff ? '✅ CLOSER' : ''}`);
    console.log('\n' + '─'.repeat(100) + '\n');
  }

  console.log('═'.repeat(100));
  console.log('CONCLUSION');
  console.log('═'.repeat(100));
  console.log('\nIf trades_raw values are closer to benchmark targets, then benchmarks');
  console.log('were likely generated from the OLD broken method (trades_raw).\n');

  await ch.close();
}

main().catch(console.error);
