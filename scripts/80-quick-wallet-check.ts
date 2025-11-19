#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Quick check for wallet ${WALLET.substring(0, 10)}...\n`);

  // Check how many unique wallet addresses match this wallet
  const result = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        count() AS trade_count
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) LIKE '${WALLET.substring(0, 10).toLowerCase()}%'
      GROUP BY wallet_address
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json<Array<any>>();

  console.log(`Found ${rows.length} wallet address(es) matching prefix:\n`);

  rows.forEach(row => {
    console.log(`${row.wallet_address}: ${parseInt(row.trade_count).toLocaleString()} trades`);
  });

  // Also check for any proxy wallet field
  const schemaCheck = await clickhouse.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default'
        AND table = 'pm_trades_canonical_v3'
        AND (name LIKE '%proxy%' OR name LIKE '%owner%' OR name LIKE '%user%')
    `,
    format: 'JSONEachRow'
  });

  const columns = await schemaCheck.json<Array<any>>();

  console.log(`\nColumns with proxy/owner/user in name:`);
  if (columns.length === 0) {
    console.log('  (none found)');
  } else {
    columns.forEach(col => {
      console.log(`  ${col.name}: ${col.type}`);
    });
  }
}

main().catch(console.error);
