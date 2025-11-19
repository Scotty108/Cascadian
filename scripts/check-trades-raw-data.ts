#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\nChecking trades_raw data...\n');

  // Check total count
  const totalQuery = `SELECT count() as total FROM default.trades_raw`;
  const totalResult = await ch.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json<any[]>();
  console.log(`Total rows in trades_raw: ${parseInt(totalData[0].total).toLocaleString()}`);

  // Check with token filter
  const noTokenQuery = `
    SELECT count() as total
    FROM default.trades_raw
    WHERE condition_id NOT LIKE '%token_%'
  `;
  const noTokenResult = await ch.query({ query: noTokenQuery, format: 'JSONEachRow' });
  const noTokenData = await noTokenResult.json<any[]>();
  console.log(`Rows without token filter: ${parseInt(noTokenData[0].total).toLocaleString()}`);

  // Check with date filter
  const dateQuery = `
    SELECT count() as total
    FROM default.trades_raw
    WHERE condition_id NOT LIKE '%token_%'
      AND block_time >= '2022-06-01'
  `;
  const dateResult = await ch.query({ query: dateQuery, format: 'JSONEachRow' });
  const dateData = await dateResult.json<any[]>();
  console.log(`Rows with token filter + date: ${parseInt(dateData[0].total).toLocaleString()}`);

  // Check unique wallets
  const walletQuery = `
    SELECT count(DISTINCT lower(wallet)) as unique_wallets
    FROM default.trades_raw
    WHERE condition_id NOT LIKE '%token_%'
      AND block_time >= '2022-06-01'
  `;
  const walletResult = await ch.query({ query: walletQuery, format: 'JSONEachRow' });
  const walletData = await walletResult.json<any[]>();
  console.log(`Unique wallets: ${parseInt(walletData[0].unique_wallets).toLocaleString()}`);

  // Sample 5 rows
  const sampleQuery = `
    SELECT wallet, condition_id, block_time
    FROM default.trades_raw
    WHERE condition_id NOT LIKE '%token_%'
    LIMIT 5
  `;
  const sampleResult = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json<any[]>();
  console.log(`\nSample rows:`);
  sampleData.forEach((row, i) => {
    console.log(`  ${i+1}. wallet: ${row.wallet}, condition_id: ${row.condition_id}, block_time: ${row.block_time}`);
  });

  await ch.close();
}

main().catch(console.error);
