#!/usr/bin/env npx tsx
/**
 * Analyze wallet gains vs losses breakdown
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('\n' + '═'.repeat(100));
  console.log(`GAINS vs LOSSES ANALYSIS: ${wallet}`);
  console.log('═'.repeat(100) + '\n');

  const query = `
    SELECT
      sum(CASE WHEN toFloat64(cashflow_usdc) > 0 THEN toFloat64(cashflow_usdc) ELSE 0 END) as total_gains,
      sum(CASE WHEN toFloat64(cashflow_usdc) < 0 THEN toFloat64(cashflow_usdc) ELSE 0 END) as total_losses,
      sum(toFloat64(cashflow_usdc)) as net_pnl,
      count() as total_trades,
      count(DISTINCT condition_id) as unique_markets
    FROM default.trades_raw
    WHERE wallet = '${wallet}'
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<any[]>();

  if (rows.length > 0) {
    const data = rows[0];
    const gains = parseFloat(data.total_gains);
    const losses = parseFloat(data.total_losses);
    const net = parseFloat(data.net_pnl);

    console.log('Cashflow Analysis:');
    console.log(`  Total Gains:    $${gains.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total Losses:   $${losses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Net P&L:        $${net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`\n  Total Trades:   ${parseInt(data.total_trades).toLocaleString()}`);
    console.log(`  Unique Markets: ${parseInt(data.unique_markets).toLocaleString()}`);

    console.log('\n' + '─'.repeat(100));
    console.log('Comparison to Polymarket UI:');
    console.log('─'.repeat(100));
    console.log('  Polymarket Gains: ~$207,000');
    console.log(`  Our Gains:        $${gains.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Difference:       $${(gains - 207000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log('  Polymarket Losses: ~$111,000');
    console.log(`  Our Losses:        $${Math.abs(losses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Difference:        $${(Math.abs(losses) - 111000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log('  Polymarket Net: ~$95,000');
    console.log(`  Our Net:        $${net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Difference:     $${(net - 95000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  console.log('\n' + '═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
