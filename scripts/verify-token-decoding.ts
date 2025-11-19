#!/usr/bin/env npx tsx
/**
 * Verify if token_ decoding is actually working in the query
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
console.log('═'.repeat(80));
console.log('VERIFY TOKEN DECODING');
console.log('═'.repeat(80));
console.log();

// Test the token_ decoding on a few samples
console.log('Test: Decode sample token_ values to hex');
console.log('─'.repeat(80));

try {
  const samples = await client.query({
    query: `
      SELECT
        condition_id_norm AS original,
        concat('0x', leftPad(
          lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
        , 64, '0')) AS decoded
      FROM default.vw_trades_canonical
      WHERE condition_id_norm LIKE 'token_%'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await samples.json<Array<{
    original: string;
    decoded: string;
  }>>();

  console.log();
  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. Original: ${row.original.substring(0, 70)}...`);
    console.log(`   Decoded:  ${row.decoded}`);
    console.log();
  });

} catch (error: any) {
  console.error('❌ Decoding test failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// Count unique CIDs before and after normalization
console.log('Count: Unique CIDs before vs after normalization');
console.log('─'.repeat(80));

try {
  const counts = await client.query({
    query: `
      WITH before AS (
        SELECT DISTINCT condition_id_norm AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
      ),
      after AS (
        SELECT DISTINCT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
      )
      SELECT
        (SELECT count() FROM before) AS before_normalization,
        (SELECT count() FROM after) AS after_normalization,
        before_normalization - after_normalization AS reduction
    `,
    format: 'JSONEachRow',
  });

  const countData = await counts.json<Array<{
    before_normalization: number;
    after_normalization: number;
    reduction: number;
  }>>();

  console.log();
  console.log(`  Before normalization: ${countData[0].before_normalization.toLocaleString()} unique CIDs`);
  console.log(`  After normalization:  ${countData[0].after_normalization.toLocaleString()} unique CIDs`);
  console.log(`  Reduction:            ${countData[0].reduction.toLocaleString()} (${(countData[0].reduction / countData[0].before_normalization * 100).toFixed(2)}%)`);
  console.log();

  if (countData[0].reduction === 0) {
    console.log('  ⚠️  WARNING: Normalization had ZERO effect!');
    console.log('     This suggests token_ CIDs decode to values already present as hex format.');
    console.log();
  } else {
    console.log(`  ✅ Normalization reduced duplicates by ${(countData[0].reduction / countData[0].before_normalization * 100).toFixed(2)}%`);
    console.log();
  }

} catch (error: any) {
  console.error('❌ Count test failed:', error?.message || error);
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
