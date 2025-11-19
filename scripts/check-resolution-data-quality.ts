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
  console.log('Checking Resolution Data Quality\n');

  // Check vw_resolutions_all data quality
  console.log('Checking vw_resolutions_all:');
  console.log('─'.repeat(80));
  const quality = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(payout_denominator = 0) AS zero_denominator,
        countIf(payout_denominator > 0) AS valid_denominator,
        countIf(length(payout_numerators) = 0) AS empty_payouts
      FROM cascadian_clean.vw_resolutions_all
    `,
    format: 'JSONEachRow',
  });

  const q = (await quality.json<Array<any>>())[0];
  console.log(`  Total:              ${q.total.toLocaleString()}`);
  console.log(`  Zero denominator:   ${q.zero_denominator.toLocaleString()}`);
  console.log(`  Valid denominator:  ${q.valid_denominator.toLocaleString()}`);
  console.log(`  Empty payouts:      ${q.empty_payouts.toLocaleString()}`);
  console.log();

  // Sample bad data
  if (q.zero_denominator > 0) {
    console.log('Sample resolutions with zero denominator:');
    const bad = await client.query({
      query: `
        SELECT *
        FROM cascadian_clean.vw_resolutions_all
        WHERE payout_denominator = 0
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const rows = await bad.json();
    console.log(JSON.stringify(rows, null, 2));
    console.log();
  }

  // Check source table (market_resolutions_final)
  console.log('Checking source table (market_resolutions_final):');
  console.log('─'.repeat(80));
  const source = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(payout_denominator = 0) AS zero_denominator,
        countIf(payout_denominator > 0) AS valid_denominator
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const s = (await source.json<Array<any>>())[0];
  console.log(`  Total:              ${s.total.toLocaleString()}`);
  console.log(`  Zero denominator:   ${s.zero_denominator.toLocaleString()}`);
  console.log(`  Valid denominator:  ${s.valid_denominator.toLocaleString()}`);
  console.log();

  // The issue is we're filtering WHERE payout_denominator > 0 in the view
  // but then somehow still getting 0 values?
  console.log('This is strange - the view filters for payout_denominator > 0');
  console.log('but we are still getting 0 values in queries.');
  console.log();
  console.log('Checking if the filter is working:');
  
  const viewDef = await client.query({
    query: `
      SELECT create_table_query
      FROM system.tables
      WHERE database = 'cascadian_clean' AND name = 'vw_resolutions_all'
    `,
    format: 'JSONEachRow',
  });

  const def = await viewDef.json<Array<{ create_table_query: string }>>();
  console.log(def[0].create_table_query.substring(0, 500));

  await client.close();
}

main().catch(console.error);
