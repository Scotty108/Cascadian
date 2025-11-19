#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  // Check how many wallets would be found by the LEFT JOIN for 30d window
  const testQuery = `
    SELECT count() as missing_count
    FROM (
      SELECT DISTINCT wallet_address
      FROM default.wallet_metrics
    ) w
    LEFT JOIN (
      SELECT wallet_address
      FROM default.wallet_metrics
      WHERE time_window = '30d'
    ) existing
    ON w.wallet_address = existing.wallet_address
    WHERE existing.wallet_address IS NULL
  `;

  const result = await ch.query({ query: testQuery, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  console.log(`\n30d window missing rows test:`);
  console.log(`  Wallets missing 30d rows: ${parseInt(data[0].missing_count).toLocaleString()}`);
  console.log(`  Expected: ${(923399 - 244133).toLocaleString()}\n`);

  // Sample a few missing wallet addresses
  const sampleQuery = `
    SELECT w.wallet_address
    FROM (
      SELECT DISTINCT wallet_address
      FROM default.wallet_metrics
    ) w
    LEFT JOIN (
      SELECT wallet_address
      FROM default.wallet_metrics
      WHERE time_window = '30d'
    ) existing
    ON w.wallet_address = existing.wallet_address
    WHERE existing.wallet_address IS NULL
    LIMIT 5
  `;

  const sampleResult = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json<any[]>();

  console.log(`Sample missing wallets:`);
  sampleData.forEach((row: any) => {
    console.log(`  ${row.wallet_address}`);
  });
  console.log();

  await ch.close();
}

main().catch(console.error);
