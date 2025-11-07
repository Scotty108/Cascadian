/**
 * Investigate schema types and data types
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

const wallets = [
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
];

async function main() {
  console.log('='.repeat(80));
  console.log('SCHEMA INVESTIGATION');
  console.log('='.repeat(80));

  // Check market_resolutions_final schema
  console.log('\n📋 market_resolutions_final SCHEMA:');
  const mrfSchema = await client.query({
    query: `DESCRIBE TABLE market_resolutions_final`,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await mrfSchema.json(), null, 2));

  // Check market_resolutions schema
  console.log('\n📋 market_resolutions SCHEMA:');
  const mrSchema = await client.query({
    query: `DESCRIBE TABLE market_resolutions`,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await mrSchema.json(), null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('TESTING market_resolutions (not _final)');
  console.log('='.repeat(80));

  const walletsStr = wallets.map(w => `'${w}'`).join(',');

  // Try joining with market_resolutions instead
  const mrJoin = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
        LIMIT 10
      )
      SELECT
        wc.condition_id as original_id,
        wc.condition_norm as normalized_id,
        mr.condition_id,
        mr.winning_index
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions mr
        ON lower(replaceAll(mr.condition_id, '0x', '')) = wc.condition_norm
      WHERE mr.condition_id IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const mrMatches = await mrJoin.json<any>();
  console.log(`\n✅ market_resolutions matches: ${mrMatches.length}`);
  console.log(JSON.stringify(mrMatches, null, 2));

  // Check coverage with market_resolutions
  const mrCoverage = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
      )
      SELECT
        COUNT(DISTINCT wc.condition_norm) as total_conditions,
        COUNT(DISTINCT CASE WHEN mr.condition_id IS NOT NULL THEN wc.condition_norm END) as matched_conditions,
        round(COUNT(DISTINCT CASE WHEN mr.condition_id IS NOT NULL THEN wc.condition_norm END) * 100.0 / COUNT(DISTINCT wc.condition_norm), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions mr
        ON lower(replaceAll(mr.condition_id, '0x', '')) = wc.condition_norm
    `,
    format: 'JSONEachRow'
  });

  const mrCoverageData = await mrCoverage.json<any>();
  console.log('\n📊 market_resolutions COVERAGE:');
  console.log(JSON.stringify(mrCoverageData, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('TESTING WITH PROPER STRING CONVERSION');
  console.log('='.repeat(80));

  // Try with toString conversion for FixedString
  const fixedStringJoin = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
        LIMIT 10
      )
      SELECT
        wc.condition_id as original_id,
        wc.condition_norm as normalized_id,
        toString(mrf.condition_id_norm) as mrf_id,
        mrf.winning_index
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON toString(mrf.condition_id_norm) = wc.condition_norm
      WHERE mrf.condition_id_norm IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const fixedMatches = await fixedStringJoin.json<any>();
  console.log(`\n✅ market_resolutions_final with toString: ${fixedMatches.length}`);
  console.log(JSON.stringify(fixedMatches, null, 2));

  // Check coverage with toString
  const fixedCoverage = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
      )
      SELECT
        COUNT(DISTINCT wc.condition_norm) as total_conditions,
        COUNT(DISTINCT CASE WHEN mrf.condition_id_norm IS NOT NULL THEN wc.condition_norm END) as matched_conditions,
        round(COUNT(DISTINCT CASE WHEN mrf.condition_id_norm IS NOT NULL THEN wc.condition_norm END) * 100.0 / COUNT(DISTINCT wc.condition_norm), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON toString(mrf.condition_id_norm) = wc.condition_norm
    `,
    format: 'JSONEachRow'
  });

  const fixedCoverageData = await fixedCoverage.json<any>();
  console.log('\n📊 market_resolutions_final with toString COVERAGE:');
  console.log(JSON.stringify(fixedCoverageData, null, 2));

  await client.close();
}

main().catch(console.error);
