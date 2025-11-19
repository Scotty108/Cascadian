#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Test decode logic - check if the formula is working
  const result = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        lower(hex(toUInt256(asset_id))) AS token_hex,
        lower(concat(repeat('0', 64 - length(hex(bitShiftRight(toUInt256(asset_id), 8)))),
                     hex(bitShiftRight(toUInt256(asset_id), 8)))) AS ctf_hex,
        lower(lpad(hex(bitAnd(toUInt256(asset_id),255)), 2, '0')) AS mask_hex,
        token_hex = concat(ctf_hex, mask_hex) AS matches
      FROM clob_fills
      WHERE asset_id NOT IN ('asset','')
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json();
  console.log('Decode test results:');
  console.log(JSON.stringify(data, null, 2));

  await clickhouse.close();
}

main();
