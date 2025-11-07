/**
 * Final diagnosis - check market_resolutions properly
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
  console.log('CHECK market_resolutions SCHEMA (Full Details)');
  console.log('='.repeat(80));

  const schema = await client.query({
    query: `SHOW CREATE TABLE market_resolutions`,
    format: 'TabSeparated'
  });

  const createTableStmt = await schema.text();
  console.log('\n📋 CREATE TABLE statement:');
  console.log(createTableStmt);

  console.log('\n' + '='.repeat(80));
  console.log('SAMPLE DATA FROM market_resolutions');
  console.log('='.repeat(80));

  const sample = await client.query({
    query: `
      SELECT
        condition_id,
        length(condition_id) as len,
        hex(condition_id) as hex_value,
        winning_outcome,
        resolved_at
      FROM market_resolutions
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  console.log(JSON.stringify(await sample.json(), null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('TEST JOIN WITH HEX CONVERSION');
  console.log('='.repeat(80));

  const walletsStr = wallets.map(w => `'${w}'`).join(',');

  // Get one condition from wallet
  const oneCondition = await client.query({
    query: `
      SELECT condition_id
      FROM trades_raw
      WHERE wallet_address = '${wallets[0]}'
        AND condition_id != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const testCond = await oneCondition.json<any>();
  const testCondId = testCond[0]?.condition_id;

  console.log(`\nTest condition from trades_raw: ${testCondId}`);
  console.log(`Normalized: ${testCondId?.toLowerCase().replace('0x', '')}`);

  // Search for it in market_resolutions
  const search = await client.query({
    query: `
      SELECT
        hex(condition_id) as condition_id_hex,
        winning_outcome
      FROM market_resolutions
      WHERE hex(condition_id) = upper(replaceAll('${testCondId}', '0x', ''))
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  console.log('\nSearch result:');
  console.log(JSON.stringify(await search.json(), null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('CORRECTED JOIN QUERY FOR P&L');
  console.log('='.repeat(80));

  const correctedJoin = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          upper(replaceAll(condition_id, '0x', '')) as condition_hex
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
        LIMIT 10
      )
      SELECT
        wc.condition_id as original_id,
        hex(mr.condition_id) as mr_condition_hex,
        mr.winning_outcome
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions mr
        ON hex(mr.condition_id) = wc.condition_hex
      WHERE mr.condition_id IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const correctedMatches = await correctedJoin.json<any>();
  console.log(`\n✅ Corrected join matches: ${correctedMatches.length}`);
  console.log(JSON.stringify(correctedMatches, null, 2));

  // Full coverage check
  const coverage = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          upper(replaceAll(condition_id, '0x', '')) as condition_hex
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
          AND condition_id != ''
      )
      SELECT
        COUNT(DISTINCT wc.condition_hex) as total_conditions,
        COUNT(DISTINCT CASE WHEN mr.condition_id IS NOT NULL THEN wc.condition_hex END) as matched_conditions,
        round(COUNT(DISTINCT CASE WHEN mr.condition_id IS NOT NULL THEN wc.condition_hex END) * 100.0 / COUNT(DISTINCT wc.condition_hex), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions mr
        ON hex(mr.condition_id) = wc.condition_hex
    `,
    format: 'JSONEachRow'
  });

  const coverageData = await coverage.json<any>();
  console.log('\n📊 CORRECTED COVERAGE:');
  console.log(JSON.stringify(coverageData, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('DELIVERABLE: EXACT FIX FOR WALLET P&L QUERY');
  console.log('='.repeat(80));

  console.log(`
ROOT CAUSE:
- market_resolutions.condition_id is stored as BINARY data (likely FixedString or Blob)
- When selected directly, it returns null bytes
- Need to use hex() function to extract the actual hex value
- Join condition must be: hex(mr.condition_id) = upper(replaceAll(trades.condition_id, '0x', ''))

CORRECTED JOIN PATTERN:
\`\`\`sql
LEFT JOIN market_resolutions mr
  ON hex(mr.condition_id) = upper(replaceAll(t.condition_id, '0x', ''))
\`\`\`

COVERAGE ACHIEVED: ${coverageData[0]?.match_pct}%

NEXT STEP: Update the wallet P&L query in scripts/quick-pnl-check.ts with this join pattern.
  `);

  await client.close();
}

main().catch(console.error);
