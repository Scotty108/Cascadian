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
  console.log('Deep dive into resolution_candidates...\n');

  // Get sample
  const sample = await client.query({
    query: 'SELECT * FROM default.resolution_candidates WHERE length(outcome) > 0 LIMIT 5',
    format: 'JSONEachRow',
  });
  const rows = await sample.json();
  console.log('Sample rows:');
  console.log(JSON.stringify(rows, null, 2));

  // Stats
  const counts = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(length(outcome) > 0) AS with_outcome,
        uniqExact(condition_id_norm) AS unique_cids,
        uniqExactIf(condition_id_norm, length(outcome) > 0) AS unique_with_outcome
      FROM default.resolution_candidates
    `,
    format: 'JSONEachRow',
  });
  const c = (await counts.json<Array<any>>())[0];
  console.log('\nStats:');
  console.log(`  Total rows:              ${c.total.toLocaleString()}`);
  console.log(`  With outcome:            ${c.with_outcome.toLocaleString()}`);
  console.log(`  Unique CIDs:             ${c.unique_cids.toLocaleString()}`);
  console.log(`  Unique CIDs w/ outcome:  ${c.unique_with_outcome.toLocaleString()}`);

  // Coverage test
  const coverage = await client.query({
    query: `
      WITH resolutions AS (
        SELECT DISTINCT condition_id_norm
        FROM default.resolution_candidates
        WHERE length(outcome) > 0
      )
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
        (SELECT count() FROM resolutions) AS res_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN resolutions r
           ON lower(concat('0x', replaceAll(r.condition_id_norm, '0x', ''))) = f.cid_hex) AS matched,
        round(100.0 * matched / fact_cids, 2) AS coverage_pct
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<Array<any>>())[0];
  console.log('\nCoverage:');
  console.log(`  Fact CIDs:       ${cov.fact_cids.toLocaleString()}`);
  console.log(`  Resolution CIDs: ${cov.res_cids.toLocaleString()}`);
  console.log(`  Matched:         ${cov.matched.toLocaleString()}`);
  console.log(`  Coverage:        ${cov.coverage_pct}%`);

  if (cov.res_cids > 150000) {
    console.log('\n✅✅✅ BREAKTHROUGH! resolution_candidates has 150K+ unique markets!');
  } else if (cov.coverage_pct > 50) {
    console.log('\n✅ HIGH COVERAGE!');
  }

  await client.close();
}

main().catch(console.error);
