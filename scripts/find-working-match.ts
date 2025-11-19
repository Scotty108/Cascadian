#!/usr/bin/env npx tsx
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
  console.log('Finding a CID that DOES match between tables...\n');

  // Get CIDs from fact_trades that DO have resolutions
  const matchedResult = await client.query({
    query: `
      WITH
      res_norm AS (
        SELECT DISTINCT
          lower(concat('0x', condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL AND payout_denominator > 0
      )
      SELECT f.cid_hex
      FROM cascadian_clean.fact_trades_clean f
      INNER JOIN res_norm r ON r.cid_hex = f.cid_hex
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const matched = await matchedResult.json<Array<{ cid_hex: string }>>();

  if (matched.length === 0) {
    console.log('❌ No matches found!');
    await client.close();
    return;
  }

  console.log('✅ Found matching CIDs:');
  matched.forEach((m, i) => console.log(`  ${i + 1}. ${m.cid_hex}`));
  console.log();

  const testCid = matched[0].cid_hex;
  console.log(`Using test CID: ${testCid}`);
  console.log();

  // Check how this CID appears in each table
  console.log('In fact_trades_clean:');
  const factResult = await client.query({
    query: `SELECT cid_hex, length(cid_hex) AS len FROM cascadian_clean.fact_trades_clean WHERE cid_hex = '${testCid}' LIMIT 1`,
    format: 'JSONEachRow',
  });
  const factRow = await factResult.json<Array<{ cid_hex: string; len: number }>>();
  console.log(`  cid_hex: ${factRow[0].cid_hex}`);
  console.log(`  length:  ${factRow[0].len}`);
  console.log();

  // Check how this appears in market_resolutions_final
  const cidWithout0x = testCid.replace('0x', '').toLowerCase();
  console.log('In market_resolutions_final:');
  const resResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) AS len,
        lower(concat('0x', condition_id_norm)) AS normalized
      FROM default.market_resolutions_final
      WHERE lower(condition_id_norm) = '${cidWithout0x}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const resRow = await resResult.json<Array<{ condition_id_norm: string; len: number; normalized: string }>>();

  if (resRow.length > 0) {
    console.log(`  condition_id_norm:   ${resRow[0].condition_id_norm}`);
    console.log(`  length:               ${resRow[0].len}`);
    console.log(`  normalized (0x+cid): ${resRow[0].normalized}`);
    console.log();
    console.log(`Match: ${testCid === resRow[0].normalized ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log('  ❌ NOT FOUND (this is weird!)');
  }

  await client.close();
}

main().catch(console.error);
