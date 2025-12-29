#!/usr/bin/env npx tsx
/**
 * Validate P&L Fix - Test corrected formula on baseline wallet
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('\n' + '═'.repeat(100));
  console.log(`P&L FIX VALIDATION: ${wallet}`);
  console.log('═'.repeat(100) + '\n');

  // Test the corrected formula
  const query = `
    SELECT
      sumIf(toFloat64(cashflow_usdc), trade_direction = 'SELL') AS gross_gains_usd,
      sumIf(toFloat64(cashflow_usdc), trade_direction = 'BUY')  AS gross_losses_usd,
      sumIf(-toFloat64(cashflow_usdc), trade_direction = 'BUY') +
      sumIf( toFloat64(cashflow_usdc), trade_direction = 'SELL') AS realized_pnl,
      count() as total_trades,
      countIf(trade_direction = 'BUY') as buy_trades,
      countIf(trade_direction = 'SELL') as sell_trades
    FROM default.trades_raw
    WHERE lower(wallet) = '${wallet}'
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<any[]>();

  if (rows.length > 0) {
    const data = rows[0];
    const gains = parseFloat(data.gross_gains_usd);
    const losses = parseFloat(data.gross_losses_usd);
    const net = parseFloat(data.realized_pnl);

    console.log('📊 CORRECTED CALCULATION:');
    console.log('─'.repeat(100));
    console.log(`  Gross Gains (SELL):  $${gains.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Gross Losses (BUY):  $${losses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Net P&L:             $${net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log(`  Total Trades:  ${parseInt(data.total_trades).toLocaleString()}`);
    console.log(`  BUY Trades:    ${parseInt(data.buy_trades).toLocaleString()}`);
    console.log(`  SELL Trades:   ${parseInt(data.sell_trades).toLocaleString()}`);

    console.log('\n' + '─'.repeat(100));
    console.log('🎯 VALIDATION vs POLYMARKET UI:');
    console.log('─'.repeat(100));

    const targetGains = 207000;
    const targetLosses = 111000;
    const targetNet = 95000;

    const gainsMatch = Math.abs(gains - targetGains) / targetGains * 100;
    const lossesMatch = Math.abs(losses - targetLosses) / targetLosses * 100;
    const netMatch = Math.abs(net - targetNet) / targetNet * 100;

    console.log(`  Expected Gains:  ~$207,000  | Actual: $${gains.toLocaleString('en-US', { minimumFractionDigits: 0 })}  | Diff: ${gainsMatch.toFixed(1)}%`);
    console.log(`  Expected Losses: ~$111,000  | Actual: $${losses.toLocaleString('en-US', { minimumFractionDigits: 0 })}  | Diff: ${lossesMatch.toFixed(1)}%`);
    console.log(`  Expected Net:    ~$95,000   | Actual: $${net.toLocaleString('en-US', { minimumFractionDigits: 0 })}   | Diff: ${netMatch.toFixed(1)}%`);

    console.log('\n' + '─'.repeat(100));
    if (gainsMatch < 10 && lossesMatch < 10 && netMatch < 10) {
      console.log('✅ VALIDATION PASSED - Formula is correct!');
      console.log('   All values within 10% of Polymarket UI');
    } else {
      console.log('⚠️  VALIDATION WARNING - Some values differ by >10%');
      console.log('   May need to investigate coverage gaps or other factors');
    }
    console.log('─'.repeat(100));
  }

  console.log('\n' + '═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
