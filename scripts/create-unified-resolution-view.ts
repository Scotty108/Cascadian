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
  console.log('Creating Unified Resolution View from api_ctf_bridge (26.44% coverage)');
  console.log('═'.repeat(80));
  console.log();

  // First, check api_ctf_bridge schema to confirm column names
  console.log('Checking api_ctf_bridge schema...');
  const schema = await client.query({
    query: 'DESCRIBE TABLE default.api_ctf_bridge',
    format: 'JSONEachRow',
  });
  const cols = await schema.json<Array<{ name: string; type: string }>>();
  console.log('Columns:', cols.map(c => c.name).join(', '));
  console.log();

  // Get sample to verify data format
  console.log('Sample data:');
  const sample = await client.query({
    query: 'SELECT * FROM default.api_ctf_bridge WHERE resolved_outcome IS NOT NULL LIMIT 3',
    format: 'JSONEachRow',
  });
  const rows = await sample.json();
  console.log(JSON.stringify(rows, null, 2));
  console.log();

  // Create the unified view
  console.log('Creating cascadian_clean.vw_resolutions_all...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_all AS
      SELECT
        lower(concat('0x', replaceAll(condition_id, '0x', ''))) AS cid_hex,
        CASE resolved_outcome
          WHEN 'Yes' THEN 0
          WHEN 'No' THEN 1
          ELSE NULL
        END AS winning_index,
        CASE resolved_outcome
          WHEN 'Yes' THEN [1, 0]
          WHEN 'No' THEN [0, 1]
          ELSE []
        END AS payout_numerators,
        1 AS payout_denominator,
        resolved_at
      FROM default.api_ctf_bridge
      WHERE resolved_outcome IS NOT NULL
    `,
  });
  console.log('✅ View created successfully');
  console.log();

  // Verify coverage
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

  if (cov.coverage_pct > 25) {
    console.log('✅ SUCCESS! Resolution view created with expected coverage');
    console.log();
    console.log('Next steps:');
    console.log('  1. Test PnL calculations against known wallets');
    console.log('  2. Verify NULL handling for unresolved positions');
    console.log('  3. Decide on API backfill for remaining 75%');
  } else {
    console.log('⚠️  Coverage lower than expected - investigate api_ctf_bridge data');
  }

  await client.close();
}

main().catch(console.error);
