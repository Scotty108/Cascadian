#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const query = `
    SELECT
      time_window,
      count() as row_count,
      count(DISTINCT wallet_address) as unique_wallets
    FROM default.wallet_metrics
    GROUP BY time_window
    ORDER BY time_window
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  console.log('\nActual Table Counts:\n');
  data.forEach((row: any) => {
    console.log(`${row.time_window}: ${row.row_count} rows, ${row.unique_wallets} unique wallets`);
  });

  const totalQuery = `SELECT count() as total, count(DISTINCT wallet_address) as wallets FROM default.wallet_metrics`;
  const totalResult = await ch.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json<any[]>();

  const totalRows = parseInt(totalData[0].total);
  const uniqueWallets = parseInt(totalData[0].wallets);
  const expectedRows = uniqueWallets * 4;

  console.log(`\nGrand Total: ${totalRows} rows, ${uniqueWallets} unique wallets`);
  console.log(`Expected: ${expectedRows} rows (${uniqueWallets} × 4)`);
  console.log(`Difference: ${expectedRows - totalRows} rows missing\n`);

  await ch.close();
}

main().catch(console.error);
