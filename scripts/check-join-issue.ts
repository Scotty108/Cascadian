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
  console.log('Diagnosing Join Issue\n');

  // Check format of condition_id_norm in vw_trades_canonical
  console.log('Sample condition_id from vw_trades_canonical:');
  const t1 = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) AS len,
        left(condition_id_norm, 2) AS prefix
      FROM default.vw_trades_canonical
      WHERE length(condition_id_norm) > 0
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const trades = await t1.json();
  console.log(JSON.stringify(trades, null, 2));
  console.log();

  // Check format in vw_resolutions_all
  console.log('Sample cid_hex from vw_resolutions_all:');
  const t2 = await client.query({
    query: `
      SELECT
        cid_hex,
        length(cid_hex) AS len,
        left(cid_hex, 2) AS prefix
      FROM cascadian_clean.vw_resolutions_all
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const res = await t2.json();
  console.log(JSON.stringify(res, null, 2));
  console.log();

  // Try to see if any join would work
  console.log('Testing different join conditions:');
  console.log('─'.repeat(80));

  const tests = [
    { name: 'As-is (what we have now)', condition: "lower(concat('0x', t.condition_id_norm)) = r.cid_hex" },
    { name: 'Direct comparison', condition: "lower(t.condition_id_norm) = r.cid_hex" },
    { name: 'Strip 0x from trades', condition: "lower(concat('0x', replaceAll(t.condition_id_norm, '0x', ''))) = r.cid_hex" },
  ];

  for (const test of tests) {
    const result = await client.query({
      query: `
        SELECT count() AS matched
        FROM default.vw_trades_canonical t
        INNER JOIN cascadian_clean.vw_resolutions_all r
          ON ${test.condition}
        LIMIT 100000
      `,
      format: 'JSONEachRow',
    });

    const count = (await result.json<Array<any>>())[0];
    console.log(`${test.name}: ${count.matched.toLocaleString()} matches`);
  }

  await client.close();
}

main().catch(console.error);
