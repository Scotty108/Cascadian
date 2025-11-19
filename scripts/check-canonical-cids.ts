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
  console.log('Checking condition_id_norm format in vw_trades_canonical...\n');

  const sample = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) AS len
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const data = await sample.json<Array<{ condition_id_norm: string; len: number }>>();
  console.log('Sample condition_id_norm values:');
  data.forEach((r, i) => console.log(`  ${i + 1}. ${r.condition_id_norm} (len: ${r.len})`));

  console.log('\nCompare to market_resolutions_final:');
  const resSample = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) AS len
      FROM default.market_resolutions_final
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const resData = await resSample.json<Array<{ condition_id_norm: string; len: number }>>();
  console.log('Sample condition_id_norm from resolutions:');
  resData.forEach((r, i) => console.log(`  ${i + 1}. ${r.condition_id_norm} (len: ${r.len})`));

  await client.close();
}

main().catch(console.error);
