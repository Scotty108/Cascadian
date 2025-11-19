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
  console.log('Checking join format compatibility\n');

  // Sample from market_resolutions_final
  console.log('Sample from market_resolutions_final:');
  const res = await client.query({
    query: `
      SELECT
        condition_id_norm,
        lower(concat('0x', condition_id_norm)) AS normalized,
        length(condition_id_norm) AS raw_len,
        length(normalized) AS norm_len
      FROM default.market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const resData = await res.json<Array<{ condition_id_norm: string; normalized: string; raw_len: number; norm_len: number }>>();
  resData.forEach((r, i) => {
    console.log(`  ${i + 1}. Raw: ${r.condition_id_norm} (len: ${r.raw_len})`);
    console.log(`     Norm: ${r.normalized} (len: ${r.norm_len})`);
  });
  console.log();

  // Sample from erc1155_condition_map
  console.log('Sample from erc1155_condition_map:');
  const map = await client.query({
    query: `
      SELECT
        token_id,
        lower(token_id) AS token_lower,
        condition_id,
        lower(condition_id) AS cid_lower,
        length(token_id) AS token_len,
        length(condition_id) AS cid_len
      FROM default.erc1155_condition_map
      WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const mapData = await map.json<Array<{
    token_id: string;
    token_lower: string;
    condition_id: string;
    cid_lower: string;
    token_len: number;
    cid_len: number;
  }>>();
  mapData.forEach((m, i) => {
    console.log(`  ${i + 1}. Token: ${m.token_id} (len: ${m.token_len})`);
    console.log(`     CID:   ${m.condition_id} (len: ${m.cid_len})`);
  });
  console.log();

  // Try to manually match
  console.log('Testing manual match:');
  if (resData.length > 0 && mapData.length > 0) {
    const resNorm = resData[0].normalized;
    const mapToken = mapData[0].token_lower;

    console.log(`  Res normalized: ${resNorm}`);
    console.log(`  Map token:      ${mapToken}`);
    console.log(`  Match: ${resNorm === mapToken ? '✅ YES' : '❌ NO'}`);
  }

  await client.close();
}

main().catch(console.error);
