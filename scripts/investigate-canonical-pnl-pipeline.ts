#!/usr/bin/env npx tsx
/**
 * Investigate Canonical P&L Pipeline
 * Step 1: Check if trade_cashflows_v3 exists and has correct data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('\n' + '═'.repeat(100));
  console.log('CANONICAL P&L PIPELINE INVESTIGATION');
  console.log('═'.repeat(100) + '\n');

  // Check if trade_cashflows_v3 exists
  console.log('Step 1: Checking for trade_cashflows_v3 table...\n');

  try {
    const tablesResult = await ch.query({
      query: "SHOW TABLES FROM default LIKE '%cashflow%'",
      format: 'JSONEachRow'
    });
    const tables = await tablesResult.json<any[]>();

    console.log('Tables matching "cashflow":');
    tables.forEach(t => console.log(`  - ${t.name}`));

    // Try trade_cashflows_v3
    if (tables.some(t => t.name === 'trade_cashflows_v3')) {
      console.log('\n✅ trade_cashflows_v3 exists!\n');

      const query = `
        SELECT
          sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as gross_gains,
          sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0) as gross_losses,
          sum(toFloat64(cashflow_usdc)) as net_pnl,
          count() as total_rows
        FROM default.trade_cashflows_v3
        WHERE lower(wallet) = '${wallet}'
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<any[]>();

      if (rows.length > 0 && parseInt(rows[0].total_rows) > 0) {
        const data = rows[0];
        const gains = parseFloat(data.gross_gains);
        const losses = parseFloat(data.gross_losses);
        const net = parseFloat(data.net_pnl);

        console.log('trade_cashflows_v3 Data:');
        console.log(`  Gross Gains:  $${gains.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        console.log(`  Gross Losses: $${losses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        console.log(`  Net P&L:      $${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        console.log(`  Total Rows:   ${parseInt(data.total_rows).toLocaleString()}`);

        console.log('\nComparison to Polymarket UI:');
        console.log(`  Expected Gains:  ~$207,000  vs  Actual: $${gains.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
        console.log(`  Expected Losses: ~$111,000  vs  Actual: $${Math.abs(losses).toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
        console.log(`  Expected Net:    ~$95,000   vs  Actual: $${net.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);

        if (Math.abs(net - 95000) < 20000) {
          console.log('\n✅ trade_cashflows_v3 appears to have CORRECT P&L!');
        } else {
          console.log('\n⚠️  trade_cashflows_v3 values differ significantly from Polymarket');
        }
      } else {
        console.log('⚠️  trade_cashflows_v3 exists but has no data for this wallet');
      }
    } else {
      console.log('\n❌ trade_cashflows_v3 does not exist\n');
    }

    // Check other potential tables
    console.log('\n' + '─'.repeat(100));
    console.log('Checking other P&L tables...\n');

    const pnlTablesResult = await ch.query({
      query: "SHOW TABLES FROM default LIKE '%pnl%'",
      format: 'JSONEachRow'
    });
    const pnlTables = await pnlTablesResult.json<any[]>();

    console.log('Tables matching "pnl":');
    pnlTables.forEach(t => console.log(`  - ${t.name}`));

  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n' + '═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
