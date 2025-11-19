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
  console.log('Analyzing market_resolutions_final structure...\n');

  // Get schema
  const schema = await client.query({
    query: 'DESCRIBE TABLE default.market_resolutions_final',
    format: 'JSONEachRow',
  });
  const cols = await schema.json<Array<{ name: string; type: string }>>();
  console.log('Schema:');
  cols.forEach(c => console.log(`  ${c.name.padEnd(30)} ${c.type}`));
  console.log();

  // Get sample with all columns
  const sample = await client.query({
    query: 'SELECT * FROM default.market_resolutions_final WHERE payout_denominator > 0 LIMIT 5',
    format: 'JSONEachRow',
  });
  const rows = await sample.json();
  console.log('Sample rows:');
  console.log(JSON.stringify(rows, null, 2));
  console.log();

  // Check coverage again
  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
        (SELECT count() FROM default.market_resolutions_final
         WHERE payout_denominator > 0) AS res_count,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN default.market_resolutions_final r
           ON lower(concat('0x', r.condition_id_norm)) = f.cid_hex
         WHERE r.payout_denominator > 0 AND r.winning_index IS NOT NULL) AS matched,
        round(100.0 * matched / fact_cids, 2) AS coverage_pct
    `,
    format: 'JSONEachRow',
  });
  const cov = (await coverage.json<Array<any>>())[0];
  console.log('Coverage:');
  console.log(`  Fact CIDs:       ${cov.fact_cids.toLocaleString()}`);
  console.log(`  Resolutions:     ${cov.res_count.toLocaleString()}`);
  console.log(`  Matched:         ${cov.matched.toLocaleString()}`);
  console.log(`  Coverage:        ${cov.coverage_pct}%`);

  await client.close();
}

main().catch(console.error);
