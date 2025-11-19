#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function debug() {
  const ch = getClickHouseClient();

  console.log('Debugging metadata table overlap...\n');

  try {
    // Check gamma_markets
    console.log('1. Checking gamma_markets table...');
    const gammaCheckQuery = `
      SELECT COUNT(*) as total FROM default.gamma_markets LIMIT 1
    `;
    const gammaCheck = await ch.query({ query: gammaCheckQuery, format: 'JSONEachRow' });
    const gammaCheckResult = await gammaCheck.json<any[]>();
    console.log(`   Rows: ${gammaCheckResult[0]?.total || 0}`);
    console.log(`   Sample IDs:`);

    const gammaSample = `SELECT condition_id FROM default.gamma_markets LIMIT 3`;
    const gammaS = await ch.query({ query: gammaSample, format: 'JSONEachRow' });
    const gammaSampleResult = await gammaS.json<any[]>();
    gammaSampleResult.forEach((row: any) => console.log(`     - ${row.condition_id}`));

  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  try {
    // Check api_markets_staging
    console.log('\n2. Checking api_markets_staging table...');
    const apiCheckQuery = `SELECT COUNT(*) as total FROM default.api_markets_staging LIMIT 1`;
    const apiCheck = await ch.query({ query: apiCheckQuery, format: 'JSONEachRow' });
    const apiCheckResult = await apiCheck.json<any[]>();
    console.log(`   Rows: ${apiCheckResult[0]?.total || 0}`);
    console.log(`   Sample IDs:`);

    const apiSample = `SELECT condition_id FROM default.api_markets_staging LIMIT 3`;
    const apiS = await ch.query({ query: apiSample, format: 'JSONEachRow' });
    const apiSampleResult = await apiS.json<any[]>();
    apiSampleResult.forEach((row: any) => console.log(`     - ${row.condition_id}`));

  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  try {
    // Check wallet's condition IDs
    console.log('\n3. Wallet condition IDs (normalized)...');
    const walletCidsQuery = `
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
      FROM default.trades_raw
      WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 3
    `;
    const walletCids = await ch.query({ query: walletCidsQuery, format: 'JSONEachRow' });
    const walletCidsResult = await walletCids.json<any[]>();
    walletCidsResult.forEach((row: any) => console.log(`     - ${row.cid_norm}`));

    // Try to find overlaps
    console.log('\n4. Testing overlap with gamma_markets...');
    const gammaOverlapTest = `
      WITH wallet_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.trades_raw
        WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        LIMIT 141
      )
      SELECT COUNT(*) as gamma_matches
      FROM wallet_cids w
      INNER JOIN default.gamma_markets g ON lower(replaceAll(g.condition_id, '0x', '')) = w.cid
    `;
    const gammaOverlap = await ch.query({ query: gammaOverlapTest, format: 'JSONEachRow' });
    const gammaOverlapResult = await gammaOverlap.json<any[]>();
    console.log(`   Matches: ${gammaOverlapResult[0]?.gamma_matches || 0}`);

    console.log('\n5. Testing overlap with api_markets_staging...');
    const apiOverlapTest = `
      WITH wallet_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.trades_raw
        WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        LIMIT 141
      )
      SELECT COUNT(*) as api_matches
      FROM wallet_cids w
      INNER JOIN default.api_markets_staging a ON w.cid = a.condition_id
    `;
    const apiOverlap = await ch.query({ query: apiOverlapTest, format: 'JSONEachRow' });
    const apiOverlapResult = await apiOverlap.json<any[]>();
    console.log(`   Matches: ${apiOverlapResult[0]?.api_matches || 0}`);

  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  await ch.close();
}

debug().catch(console.error);
