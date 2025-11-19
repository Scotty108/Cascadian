#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function check() {
  const ch = getClickHouseClient();

  console.log('Checking if wallet market IDs exist in metadata tables...\n');

  try {
    // Get first wallet CID
    const cidQuery = `
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
      FROM default.trades_raw
      WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 1
    `;
    const cidRes = await ch.query({ query: cidQuery, format: 'JSONEachRow' });
    const cidData = await cidRes.json<any[]>();
    const testCid = cidData[0]?.cid;
    console.log(`Test CID from wallet: ${testCid}\n`);

    // Check gamma_markets
    console.log(`Searching in gamma_markets...`);
    const gammaCheck = `
      SELECT condition_id FROM default.gamma_markets
      WHERE lower(replaceAll(condition_id, '0x', '')) = '${testCid}'
      LIMIT 1
    `;
    const gammaRes = await ch.query({ query: gammaCheck, format: 'JSONEachRow' });
    const gammaFound = await gammaRes.json<any[]>();
    console.log(`  Found: ${gammaFound.length > 0 ? gammaFound[0]?.condition_id : 'NOT FOUND'}`);

    // Check api_markets_staging
    console.log(`\nSearching in api_markets_staging...`);
    const apiCheck = `
      SELECT condition_id FROM default.api_markets_staging
      WHERE lower(condition_id) = '${testCid}'
      LIMIT 1
    `;
    const apiRes = await ch.query({ query: apiCheck, format: 'JSONEachRow' });
    const apiFound = await apiRes.json<any[]>();
    console.log(`  Found: ${apiFound.length > 0 ? apiFound[0]?.condition_id : 'NOT FOUND'}`);

    // Check market_resolutions_final (what we know DOES contain the data)
    console.log(`\nSearching in market_resolutions_final...`);
    const resCheck = `
      SELECT condition_id_norm FROM default.market_resolutions_final
      WHERE condition_id_norm = '${testCid}'
      LIMIT 1
    `;
    const resRes = await ch.query({ query: resCheck, format: 'JSONEachRow' });
    const resFound = await resRes.json<any[]>();
    console.log(`  Found: ${resFound.length > 0 ? 'YES' : 'NOT FOUND'}`);

    console.log('\nConclusion: metadata tables may not contain all wallet market IDs.');
    console.log('The wallet may have traded on markets not yet in gamma_markets or api_markets_staging.');

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

check().catch(console.error);
