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
  console.log('Creating Unified Resolution View from market_resolutions_final');
  console.log('═'.repeat(80));
  console.log();

  console.log('Creating cascadian_clean.vw_resolutions_all...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_all AS
      SELECT
        lower(concat('0x', condition_id_norm)) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        winning_outcome,
        source
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND winning_index IS NOT NULL
    `,
  });
  console.log('✅ View created successfully');
  console.log();

  // Verify the view
  console.log('Verifying view...');
  const sample = await client.query({
    query: 'SELECT * FROM cascadian_clean.vw_resolutions_all LIMIT 5',
    format: 'JSONEachRow',
  });
  const rows = await sample.json();
  console.log('Sample data:');
  console.log(JSON.stringify(rows, null, 2));
  console.log();

  // Check coverage
  console.log('Verifying coverage...');
  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_all) AS res_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN cascadian_clean.vw_resolutions_all r
           ON f.cid_hex = r.cid_hex) AS matched,
        round(100.0 * matched / fact_cids, 2) AS coverage_pct
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<Array<any>>())[0];
  console.log(`  Fact CIDs:       ${cov.fact_cids.toLocaleString()}`);
  console.log(`  Resolution CIDs: ${cov.res_cids.toLocaleString()}`);
  console.log(`  Matched:         ${cov.matched.toLocaleString()}`);
  console.log(`  Coverage:        ${cov.coverage_pct}%`);
  console.log();

  if (cov.coverage_pct > 20) {
    console.log('✅ SUCCESS! Resolution view created with expected coverage');
    console.log();
    console.log('Next: Update PnL views to use vw_resolutions_all');
  } else {
    console.log('⚠️  Coverage lower than expected');
  }

  await client.close();
}

main().catch(console.error);
