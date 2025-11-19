/**
 * Find which resolution table has the data we need
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
  console.log('SOLUTION 1: Use market_resolutions (String type)');
  console.log('='.repeat(80));

  const walletsStr = wallets.map(w => `'${w}'`).join(',');

  // Try market_resolutions with just the fields it has
  const mrResult = await client.query({
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
        mr.condition_id as mr_condition_id,
        mr.winning_outcome
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions mr
        ON lower(replaceAll(mr.condition_id, '0x', '')) = wc.condition_norm
      WHERE mr.condition_id IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const mrMatches = await mrResult.json<any>();
  console.log(`\n✅ market_resolutions matches: ${mrMatches.length}`);
  console.log(JSON.stringify(mrMatches, null, 2));

  // Coverage check
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
  console.log('SOLUTION 2: Fix FixedString join with CAST');
  console.log('='.repeat(80));

  // Try fixing the FixedString join with CAST
  const fixedResult = await client.query({
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
        CAST(mrf.condition_id_norm AS String) as mrf_id,
        mrf.winning_index,
        mrf.payout_numerators
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON CAST(mrf.condition_id_norm AS String) = wc.condition_norm
      WHERE mrf.condition_id_norm != toFixedString('', 64)
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const fixedMatches = await fixedResult.json<any>();
  console.log(`\n✅ market_resolutions_final with CAST: ${fixedMatches.length}`);
  console.log(JSON.stringify(fixedMatches, null, 2));

  // Coverage with CAST
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
        COUNT(DISTINCT CASE WHEN mrf.condition_id_norm != toFixedString('', 64) THEN wc.condition_norm END) as matched_conditions,
        round(COUNT(DISTINCT CASE WHEN mrf.condition_id_norm != toFixedString('', 64) THEN wc.condition_norm END) * 100.0 / COUNT(DISTINCT wc.condition_norm), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON CAST(mrf.condition_id_norm AS String) = wc.condition_norm
    `,
    format: 'JSONEachRow'
  });

  const fixedCoverageData = await fixedCoverage.json<any>();
  console.log('\n📊 market_resolutions_final with CAST COVERAGE:');
  console.log(JSON.stringify(fixedCoverageData, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDED FIX FOR WALLET P&L QUERY');
  console.log('='.repeat(80));

  console.log(`
The issue is a FixedString(64) vs String type mismatch in the join condition.

TWO SOLUTIONS:

1. Use market_resolutions table (String type):
   - Has: condition_id (String), winning_outcome
   - Missing: winning_index, payout_numerators
   - Coverage: ${mrCoverageData[0]?.match_pct}%

2. Fix market_resolutions_final join with CAST:
   - Has: condition_id_norm (FixedString(64)), winning_index, payout_numerators
   - Fix: CAST(mrf.condition_id_norm AS String) = normalized_condition_id
   - Coverage: ${fixedCoverageData[0]?.match_pct}%

RECOMMENDED: Use Solution 2 (market_resolutions_final with CAST)
- Has all fields needed for P&L calculation
- Higher coverage
- Just needs proper type casting in JOIN
  `);

  await client.close();
}

main().catch(console.error);
