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
  console.log('Checking Condition ID Quality in vw_trades_canonical\n');

  // Check for zero/invalid condition_ids
  const quality = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000') AS zero_cid,
        countIf(length(condition_id_norm) != 66) AS wrong_length,
        countIf(condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND length(condition_id_norm) = 66) AS valid_cid
      FROM default.vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });

  const q = (await quality.json<Array<any>>())[0];
  console.log('Condition ID quality:');
  console.log(`  Total trades:      ${q.total.toLocaleString()}`);
  console.log(`  Zero CID:          ${q.zero_cid.toLocaleString()} (${(100 * q.zero_cid / q.total).toFixed(2)}%)`);
  console.log(`  Wrong length:      ${q.wrong_length.toLocaleString()}`);
  console.log(`  Valid CID:         ${q.valid_cid.toLocaleString()} (${(100 * q.valid_cid / q.total).toFixed(2)}%)`);
  console.log();

  // Check actual join matches with resolution data
  console.log('Checking actual resolution matches:');
  const matches = await client.query({
    query: `
      SELECT
        (SELECT count() FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS valid_trades,
        (SELECT count() FROM default.vw_trades_canonical t
         INNER JOIN cascadian_clean.vw_resolutions_all r
           ON lower(t.condition_id_norm) = r.cid_hex
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS matched_trades
    `,
    format: 'JSONEachRow',
  });

  const m = (await matches.json<Array<any>>())[0];
  console.log(`  Valid trades:      ${m.valid_trades.toLocaleString()}`);
  console.log(`  Matched with res:  ${m.matched_trades.toLocaleString()} (${(100 * m.matched_trades / m.valid_trades).toFixed(2)}%)`);
  console.log();

  // Sample a matched trade to see the actual data
  console.log('Sample matched trade with full data:');
  const sample = await client.query({
    query: `
      SELECT
        t.condition_id_norm,
        t.shares,
        t.usd_value,
        t.outcome_index,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator
      FROM default.vw_trades_canonical t
      INNER JOIN cascadian_clean.vw_resolutions_all r
        ON lower(t.condition_id_norm) = r.cid_hex
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const s = await sample.json();
  console.log(JSON.stringify(s, null, 2));

  await client.close();
}

main().catch(console.error);
