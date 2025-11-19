#!/usr/bin/env npx tsx
/**
 * CHECK TREF-ONLY CID FORMAT
 *
 * Determine what format the 2,337 tref-only CIDs have in raw table
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('Checking format of tref-only CIDs in raw table...');
console.log();

try {
  const formatCheck = await client.query({
    query: `
      WITH
      vwc_cids AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm),
      tref_cids_hex AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw_enriched_final
        WHERE lower(condition_id) LIKE '0x%'
          AND condition_id != ''
          AND condition_id != '0x'
          AND condition_id != concat('0x', repeat('0',64))
      ),
      tref_only_hex AS (
        SELECT cid FROM tref_cids_hex WHERE cid NOT IN (SELECT cid FROM vwc_cids)
      )
      SELECT
        (SELECT count() FROM tref_only_hex) AS tref_only_hex_count,
        (SELECT count() AS cnt FROM default.trades_raw_enriched_final
         WHERE lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) IN (SELECT cid FROM tref_only_hex)
        ) AS rows_for_hex_only
    `,
    format: 'JSONEachRow',
  });

  const formatData = await formatCheck.json<Array<{
    tref_only_hex_count: number;
    rows_for_hex_only: number;
  }>>();

  console.log('Hex format tref-only CIDs:');
  console.log(`  Unique CIDs (hex):   ${formatData[0].tref_only_hex_count.toLocaleString()}`);
  console.log(`  Rows (hex):          ${formatData[0].rows_for_hex_only.toLocaleString()}`);
  console.log();

  // Check token format
  const tokenCheck = await client.query({
    query: `
      WITH
      vwc_cids AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm)
      SELECT
        count() AS token_rows,
        uniqExact(condition_id) AS unique_token_ids
      FROM default.trades_raw_enriched_final
      WHERE lower(condition_id) LIKE 'token_%'
    `,
    format: 'JSONEachRow',
  });

  const tokenData = await tokenCheck.json<Array<{
    token_rows: number;
    unique_token_ids: number;
  }>>();

  console.log('Token format in trades_raw_enriched_final:');
  console.log(`  Rows (token_):       ${tokenData[0].token_rows.toLocaleString()}`);
  console.log(`  Unique token_ IDs:   ${tokenData[0].unique_token_ids.toLocaleString()}`);
  console.log();

  if (formatData[0].tref_only_hex_count === 2337) {
    console.log('✅ All 2,337 tref-only CIDs are in HEX format (not token_)');
    console.log('   Can safely INSERT from hex-only query without token_ decoding');
  }

} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
