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
  console.log('Checking leading zero patterns more carefully...\n');

  // Sample raw condition_id_norm from resolutions
  console.log('Sample condition_id_norm from market_resolutions_final (RAW, no 0x):');
  const resRaw = await client.query({
    query: 'SELECT condition_id_norm FROM default.market_resolutions_final LIMIT 10',
    format: 'JSONEachRow',
  });
  const resData = await resRaw.json<Array<{ condition_id_norm: string }>>();
  resData.forEach((r, i) => {
    const leadingZeros = r.condition_id_norm.match(/^(0+)/)?.[0].length || 0;
    console.log(`  ${i + 1}. ${r.condition_id_norm} (${leadingZeros} leading zeros)`);
  });
  console.log();

  // Sample from fact_trades (with 0x)
  console.log('Sample cid_hex from fact_trades_clean (with 0x):');
  const factData = await client.query({
    query: 'SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean LIMIT 10',
    format: 'JSONEachRow',
  });
  const facts = await factData.json<Array<{ cid_hex: string }>>();
  facts.forEach((f, i) => {
    const withoutPrefix = f.cid_hex.replace('0x', '');
    const leadingZeros = withoutPrefix.match(/^(0+)/)?.[0].length || 0;
    console.log(`  ${i + 1}. ${f.cid_hex} (${leadingZeros} leading zeros after removing 0x)`);
  });
  console.log();

  // Count by leading zero count
  console.log('Distribution of leading zeros in resolutions:');
  const distResult = await client.query({
    query: `
      SELECT
        length(condition_id_norm) - length(ltrim(condition_id_norm, '0')) AS leading_zero_count,
        count() AS markets
      FROM default.market_resolutions_final
      GROUP BY leading_zero_count
      ORDER BY leading_zero_count
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const dist = await distResult.json<Array<{ leading_zero_count: number; markets: number }>>();
  dist.forEach(d => console.log(`  ${d.leading_zero_count} zeros: ${d.markets.toLocaleString()} markets`));

  await client.close();
}

main().catch(console.error);
