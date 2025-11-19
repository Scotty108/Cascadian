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
  console.log('DEBUG: ERC1155 Condition Map\n');

  // Check join without WHERE clause
  console.log('Test 1: Join without WHERE clause...');
  const test1 = await client.query({
    query: `
      SELECT count() AS total_joined
      FROM default.market_resolutions_final r
      INNER JOIN default.erc1155_condition_map m
        ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
    `,
    format: 'JSONEachRow',
  });
  const t1 = (await test1.json<Array<{ total_joined: number }>>())[0];
  console.log(`  Rows after INNER JOIN: ${t1.total_joined.toLocaleString()}`);
  console.log();

  // Check WITH where clause
  console.log('Test 2: Add WHERE clause...');
  const test2 = await client.query({
    query: `
      SELECT count() AS with_payout_data
      FROM default.market_resolutions_final r
      INNER JOIN default.erc1155_condition_map m
        ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
      WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });
  const t2 = (await test2.json<Array<{ with_payout_data: number }>>())[0];
  console.log(`  Rows with payout data: ${t2.with_payout_data.toLocaleString()}`);
  console.log();

  // Sample the mapped condition_ids
  console.log('Test 3: Sample mapped condition_ids...');
  const test3 = await client.query({
    query: `
      SELECT
        lower(m.condition_id) AS cid_from_map,
        length(lower(m.condition_id)) AS len
      FROM default.market_resolutions_final r
      INNER JOIN default.erc1155_condition_map m
        ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
      WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const t3 = await test3.json<Array<{ cid_from_map: string; len: number }>>();
  console.log('Sample mapped CIDs:');
  t3.forEach((r, i) => console.log(`  ${i + 1}. ${r.cid_from_map} (len: ${r.len})`));
  console.log();

  // Compare to fact_trades
  console.log('Test 4: Do any mapped CIDs exist in fact_trades?');
  if (t3.length > 0) {
    const testCid = t3[0].cid_from_map;
    const test4 = await client.query({
      query: `
        SELECT count() AS found
        FROM cascadian_clean.fact_trades_clean
        WHERE cid_hex = '${testCid}'
      `,
      format: 'JSONEachRow',
    });
    const t4 = (await test4.json<Array<{ found: number }>>())[0];
    console.log(`  Test CID: ${testCid}`);
    console.log(`  Found in fact_trades: ${t4.found > 0 ? '✅ YES' : '❌ NO'}`);
  }

  await client.close();
}

main().catch(console.error);
