#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function check() {
  const ch = getClickHouseClient();

  console.log('Checking dim_markets for wallet market coverage...\n');

  try {
    const testCid = '01c2d9c6df76defb67e5c08e8f34be3b6d2d59109466c09a1963eb9acf4108d4';

    // Check dim_markets
    console.log(`Testing dim_markets with CID: ${testCid}`);
    const dimCheck = `
      SELECT condition_id_norm, question, category FROM default.dim_markets
      WHERE condition_id_norm = '${testCid}'
      LIMIT 1
    `;
    const dimRes = await ch.query({ query: dimCheck, format: 'JSONEachRow' });
    const dimFound = await dimRes.json<any[]>();

    if (dimFound.length > 0) {
      console.log('  Found in dim_markets!');
      console.log(`    condition_id_norm: ${dimFound[0]?.condition_id_norm}`);
      console.log(`    question: ${dimFound[0]?.question}`);
      console.log(`    category: ${dimFound[0]?.category}`);
    } else {
      console.log('  NOT FOUND in dim_markets');
    }

    // Try counting how many of the wallet's markets are in dim_markets
    console.log('\nCounting wallet market overlap with dim_markets...');
    const walletCids = `
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
      FROM default.trades_raw
      WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 141
    `;
    const walletRes = await ch.query({ query: walletCids, format: 'JSONEachRow' });
    const walletCidsData = await walletRes.json<any[]>();
    const cidArray = walletCidsData.map((w: any) => `'${w.cid}'`).join(',');

    const overlapQuery = `
      SELECT COUNT(*) as found, COUNT(DISTINCT question) as with_question
      FROM default.dim_markets
      WHERE condition_id_norm IN (${cidArray})
    `;
    const overlapRes = await ch.query({ query: overlapQuery, format: 'JSONEachRow' });
    const overlapData = await overlapRes.json<any[]>();
    console.log(`  Markets in dim_markets: ${overlapData[0]?.found || 0}/141`);
    console.log(`  With question field: ${overlapData[0]?.with_question || 0}/141`);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

check().catch(console.error);
