#!/usr/bin/env npx tsx
/**
 * Check baseline wallet P&L for validation
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const query = `
    SELECT
      wallet_address,
      time_window,
      realized_pnl,
      unrealized_payout,
      realized_pnl + unrealized_payout as total_pnl,
      total_trades,
      markets_traded,
      win_rate,
      omega_ratio,
      roi_pct
    FROM default.wallet_metrics
    WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    ORDER BY
      CASE time_window
        WHEN '30d' THEN 1
        WHEN '90d' THEN 2
        WHEN '180d' THEN 3
        WHEN 'lifetime' THEN 4
      END
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<any[]>();

  console.log('\n' + '═'.repeat(100));
  console.log('BASELINE WALLET: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
  console.log('═'.repeat(100) + '\n');

  rows.forEach(row => {
    console.log(`Time Window: ${row.time_window}`);
    console.log(`  Realized P&L: $${parseFloat(row.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Unrealized Payout: $${parseFloat(row.unrealized_payout).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total P&L: $${parseFloat(row.total_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total Trades: ${parseInt(row.total_trades).toLocaleString()}`);
    console.log(`  Markets Traded: ${parseInt(row.markets_traded).toLocaleString()}`);
    console.log(`  Win Rate: ${(parseFloat(row.win_rate) * 100).toFixed(2)}%`);
    console.log(`  Omega Ratio: ${parseFloat(row.omega_ratio).toFixed(4)}`);
    console.log(`  ROI%: ${parseFloat(row.roi_pct).toFixed(2)}%`);
    console.log('');
  });

  console.log('═'.repeat(100));
  console.log(`Expected lifetime total P&L: -$27,558.71`);
  console.log(`Actual lifetime total P&L: $${parseFloat(rows.find(r => r.time_window === 'lifetime')?.total_pnl || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
