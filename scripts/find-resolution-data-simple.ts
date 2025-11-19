/**
 * Simplified search for resolution data
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
  const walletsStr = wallets.map(w => `'${w}'`).join(',');

  console.log('='.repeat(80));
  console.log('KEY FINDING: FORMAT MISMATCH');
  console.log('='.repeat(80));

  console.log('\n📐 trades_raw condition_id format:');
  const tradesFormat = await client.query({
    query: `
      SELECT
        condition_id,
        length(condition_id) as len,
        substring(condition_id, 1, 2) as prefix
      FROM trades_raw
      WHERE wallet_address = '${wallets[0]}'
        AND condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await tradesFormat.json(), null, 2));

  console.log('\n📐 market_resolutions_final condition_id_norm format:');
  const mrfFormat = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        substring(condition_id_norm, 1, 2) as prefix
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await mrfFormat.json(), null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('TESTING NORMALIZATION JOIN');
  console.log('='.repeat(80));

  // Test if normalization fixes the join
  const normalizedJoin = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
      )
      SELECT
        wc.condition_id as original_id,
        wc.condition_norm as normalized_id,
        mrf.condition_id_norm as mrf_id,
        mrf.winning_index
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON wc.condition_norm = mrf.condition_id_norm
      WHERE mrf.condition_id_norm IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const matches = await normalizedJoin.json<any>();
  console.log(`\n✅ Found ${matches.length} matches with normalization:`);
  console.log(JSON.stringify(matches, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('COVERAGE ANALYSIS');
  console.log('='.repeat(80));

  const coverage = await client.query({
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
        COUNT(DISTINCT mrf.condition_id_norm) as matched_conditions,
        round(COUNT(DISTINCT mrf.condition_id_norm) * 100.0 / COUNT(DISTINCT wc.condition_norm), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON wc.condition_norm = mrf.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const coverageData = await coverage.json<any>();
  console.log('\n📊 COVERAGE:');
  console.log(JSON.stringify(coverageData, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('UNMATCHED CONDITIONS');
  console.log('='.repeat(80));

  const unmatched = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
      )
      SELECT
        wc.condition_id,
        wc.condition_norm,
        COUNT(*) as trade_count
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON wc.condition_norm = mrf.condition_id_norm
      WHERE mrf.condition_id_norm IS NULL
      GROUP BY wc.condition_id, wc.condition_norm
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const unmatchedData = await unmatched.json<any>();
  console.log(`\n❌ Top 20 unmatched conditions:`);
  console.log(JSON.stringify(unmatchedData, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('CHECKING OTHER POSSIBLE TABLES');
  console.log('='.repeat(80));

  // Try to list tables by querying them directly
  const possibleTables = [
    'market_resolutions',
    'markets',
    'conditions',
    'outcomes',
    'settlements',
    'pm_markets',
    'clob_markets'
  ];

  for (const tableName of possibleTables) {
    try {
      const test = await client.query({
        query: `SELECT COUNT(*) as cnt FROM ${tableName} LIMIT 1`,
        format: 'JSONEachRow'
      });
      const result = await test.json();
      console.log(`✅ Table exists: ${tableName} (${result[0]?.cnt || 0} rows)`);
    } catch (err: any) {
      console.log(`❌ Table not found: ${tableName}`);
    }
  }

  await client.close();
}

main().catch(console.error);
