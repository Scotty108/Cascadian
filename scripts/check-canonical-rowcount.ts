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
  console.log('Checking row counts...\n');

  const total = await client.query({
    query: 'SELECT count() AS c FROM default.vw_trades_canonical',
    format: 'JSONEachRow',
  });
  const totalRows = (await total.json<Array<{ c: number }>>())[0].c;

  const nonZero = await client.query({
    query: `
      SELECT count() AS c
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const nonZeroRows = (await nonZero.json<Array<{ c: number }>>())[0].c;

  console.log(`Total rows in vw_trades_canonical:       ${totalRows.toLocaleString()}`);
  console.log(`Non-zero condition_id rows:              ${nonZeroRows.toLocaleString()}`);
  console.log(`Percentage:                              ${(100 * nonZeroRows / totalRows).toFixed(2)}%`);

  await client.close();
}

main().catch(console.error);
