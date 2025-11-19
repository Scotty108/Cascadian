#!/usr/bin/env npx tsx
/**
 * Check for existing wallet-level P&L views
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('\n' + '═'.repeat(100));
  console.log('CHECKING WALLET-LEVEL P&L VIEWS');
  console.log('═'.repeat(100) + '\n');

  const views = [
    'wallet_realized_pnl_v3',
    'wallet_realized_pnl_v2',
    'wallet_pnl_summary_final',
    'wallet_pnl_summary_v2',
    'vw_wallet_pnl_summary',
    'vw_wallet_total_pnl'
  ];

  for (const viewName of views) {
    console.log(`Testing: ${viewName}...`);

    try {
      const query = `
        SELECT *
        FROM default.${viewName}
        WHERE lower(wallet) = '${wallet}'
          OR lower(wallet_address) = '${wallet}'
        LIMIT 1
      `;

      const result = await ch.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<any[]>();

      if (rows.length > 0) {
        console.log(`  ✅ EXISTS and has data for baseline wallet\n`);
        console.log(`  Columns:`, Object.keys(rows[0]).join(', '));
        console.log(`  Sample data:`, JSON.stringify(rows[0], null, 2));
        console.log('');
      } else {
        console.log(`  ⚠️  EXISTS but no data for baseline wallet\n`);
      }
    } catch (error: any) {
      if (error.message.includes('UNKNOWN_TABLE')) {
        console.log(`  ❌ Does not exist\n`);
      } else {
        console.log(`  ❌ Error: ${error.message}\n`);
      }
    }
  }

  console.log('═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
