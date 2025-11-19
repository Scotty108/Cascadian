#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\nChecking for metadata table...\n');

  // Check if market_metadata_wallet_enriched exists
  const checkQuery = `
    SELECT count() as total
    FROM system.tables
    WHERE database = 'default'
      AND name = 'market_metadata_wallet_enriched'
  `;

  const result = await ch.query({ query: checkQuery, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  if (parseInt(data[0].total) > 0) {
    console.log('✅ market_metadata_wallet_enriched exists');

    const countQuery = `SELECT count() as total FROM default.market_metadata_wallet_enriched`;
    const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    console.log(`   Rows: ${parseInt(countData[0].total).toLocaleString()}\n`);
  } else {
    console.log('⚠️  market_metadata_wallet_enriched does NOT exist');
    console.log('   This is expected for MVP - leaderboard will use LEFT JOIN with graceful fallback\n');
  }

  await ch.close();
}

main().catch(console.error);
