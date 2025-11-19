#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('=== Checking Metadata Coverage for Wallet Map Markets ===\n');
  
  // Get the CIDs from wallet map
  const cidsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT cid_hex
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
        AND system_wallet = '${SYSTEM_WALLET}'
      LIMIT 77
    `,
    format: 'JSONEachRow'
  });
  const cids = await cidsResult.json<Array<{cid_hex: string}>>();
  console.log(`Total unique CIDs from wallet map: ${cids.length}\n`);

  // Check gamma_markets
  const gammaResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as found
      FROM default.gamma_markets
      WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const gamma = await gammaResult.json<Array<any>>();
  console.log(`Found in gamma_markets: ${gamma[0].found}/77`);

  // Check api_markets_staging
  const apiResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as found
      FROM default.api_markets_staging
      WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const api = await apiResult.json<Array<any>>();
  console.log(`Found in api_markets_staging: ${api[0].found}/77`);

  // Check dim_markets (try both formats)
  const dimResult1 = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as found
      FROM default.dim_markets
      WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const dim1 = await dimResult1.json<Array<any>>();
  console.log(`Found in dim_markets (condition_id): ${dim1[0].found}/77`);

  // Try normalized format
  const cidsNorm = cids.map(c => c.cid_hex.toLowerCase().replace('0x', ''));
  const dimResult2 = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as found
      FROM default.dim_markets
      WHERE condition_id_norm IN (${cidsNorm.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const dim2 = await dimResult2.json<Array<any>>();
  console.log(`Found in dim_markets (condition_id_norm): ${dim2[0].found}/77`);

  // Check market_resolutions_final
  const resResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as found
      FROM default.market_resolutions_final
      WHERE condition_id_norm IN (${cidsNorm.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const res = await resResult.json<Array<any>>();
  console.log(`Found in market_resolutions_final: ${res[0].found}/77\n`);

  // Sample a market that exists in resolutions to see if we can get metadata
  if (res[0].found > 0) {
    console.log('=== Sample Market with Resolution Data ===\n');
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          r.condition_id_norm,
          r.winning_outcome,
          r.resolved_at,
          d.question,
          a.question as api_question
        FROM default.market_resolutions_final r
        LEFT JOIN default.dim_markets d
          ON r.condition_id_norm = d.condition_id_norm
        LEFT JOIN default.api_markets_staging a
          ON '0x' || r.condition_id_norm = a.condition_id
        WHERE r.condition_id_norm IN (${cidsNorm.map(c => `'${c}'`).join(',')})
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<Array<any>>();
    samples.forEach((s, i) => {
      console.log(`${i+1}. CID: ${s.condition_id_norm.substring(0, 20)}...`);
      console.log(`   Winner: ${s.winning_outcome}`);
      console.log(`   Resolved: ${s.resolved_at}`);
      console.log(`   dim_markets title: ${s.question || 'NULL'}`);
      console.log(`   api_markets title: ${s.api_question || 'NULL'}\n`);
    });
  }
}

main().catch(console.error);
