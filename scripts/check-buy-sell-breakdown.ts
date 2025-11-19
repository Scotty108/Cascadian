#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('\n' + '═'.repeat(100));
  console.log(`BUY vs SELL BREAKDOWN: ${wallet}`);
  console.log('═'.repeat(100) + '\n');

  const query = `
    SELECT
      trade_direction,
      count() as trade_count,
      sum(toFloat64(cashflow_usdc)) as total_cashflow,
      avg(toFloat64(cashflow_usdc)) as avg_cashflow,
      min(toFloat64(cashflow_usdc)) as min_cashflow,
      max(toFloat64(cashflow_usdc)) as max_cashflow
    FROM default.trades_raw
    WHERE wallet = '${wallet}'
      AND length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY trade_direction
    ORDER BY trade_direction
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<any[]>();

  rows.forEach(row => {
    console.log(`\n${row.trade_direction}:`);
    console.log(`  Trade Count:     ${parseInt(row.trade_count).toLocaleString()}`);
    console.log(`  Total Cashflow:  $${parseFloat(row.total_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Avg Cashflow:    $${parseFloat(row.avg_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Min Cashflow:    $${parseFloat(row.min_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Max Cashflow:    $${parseFloat(row.max_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  });

  // Sample some SELL trades
  console.log('\n' + '─'.repeat(100));
  console.log('SAMPLE SELL TRADES:');
  console.log('─'.repeat(100) + '\n');

  const sampleQuery = `
    SELECT
      trade_direction,
      cashflow_usdc,
      shares,
      entry_price
    FROM default.trades_raw
    WHERE wallet = '${wallet}'
      AND trade_direction = 'SELL'
      AND length(replaceAll(condition_id, '0x', '')) = 64
    LIMIT 10
  `;

  const sampleResult = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json<any[]>();

  samples.forEach(s => {
    console.log(`Direction: ${s.trade_direction} | Cashflow: $${parseFloat(s.cashflow_usdc).toFixed(2)} | Shares: ${s.shares} | Price: ${s.entry_price}`);
  });

  console.log('\n' + '═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
