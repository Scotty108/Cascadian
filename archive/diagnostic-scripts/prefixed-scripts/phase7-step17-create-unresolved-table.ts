import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.17: CREATE UNRESOLVED CTF DOCUMENTATION TABLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Creating permanent documentation table...\n');

  // Drop if exists (from previous view)
  await clickhouse.command({ query: `DROP TABLE IF EXISTS default.unresolved_ctf_markets` });

  // Create table
  const createTableSQL = `
    CREATE TABLE default.unresolved_ctf_markets (
      ctf_64 String,
      estimated_shares Float64,
      estimated_value_usd Float64,
      reason_code LowCardinality(String),
      in_bridge Bool,
      has_slug Bool,
      has_resolution Bool,
      documented_at DateTime DEFAULT now(),
      notes String
    ) ENGINE = MergeTree()
    ORDER BY ctf_64
  `;

  await clickhouse.command({ query: createTableSQL });

  console.log('   ✅ Table created: default.unresolved_ctf_markets\n');

  // Insert the 5 CTFs
  console.log('Inserting the 5 unresolved CTFs...\n');

  const insertSQL = `
    INSERT INTO default.unresolved_ctf_markets VALUES
      ('001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48', 6109, 6109, 'no_slug_identity_fallback', true, false, false, now(), 'In bridge via identity fallback, no slug available'),
      ('00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af', 3359, 3359, 'no_slug_identity_fallback', true, false, false, now(), 'In bridge via identity fallback, no slug available'),
      ('00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb', 2000, 2000, 'no_slug_identity_fallback', true, false, false, now(), 'In bridge via identity fallback, no slug available'),
      ('001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e', 1000, 1000, 'no_slug_identity_fallback', true, false, false, now(), 'In bridge via identity fallback, no slug available'),
      ('00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22', 1223, 1223, 'not_in_bridge', false, false, false, now(), 'Not found in any bridge table')
  `;

  await clickhouse.command({ query: insertSQL });

  console.log('   ✅ Inserted 5 CTF records\n');

  // Query to verify
  const query = await clickhouse.query({
    query: `
      SELECT
        ctf_64,
        estimated_shares,
        estimated_value_usd,
        reason_code,
        in_bridge,
        has_slug,
        has_resolution,
        notes
      FROM default.unresolved_ctf_markets
      ORDER BY estimated_value_usd DESC
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await query.json();

  console.log('Documented CTFs:\n');

  let totalShares = 0;
  let totalValue = 0;

  rows.forEach((r, i) => {
    totalShares += r.estimated_shares;
    totalValue += r.estimated_value_usd;

    console.log(`   ${i + 1}. CTF: ${r.ctf_64.substring(0, 20)}...`);
    console.log(`      Shares: ${r.estimated_shares.toLocaleString()}`);
    console.log(`      Estimated value: $${r.estimated_value_usd.toLocaleString()}`);
    console.log(`      Reason: ${r.reason_code}`);
    console.log(`      In bridge: ${r.in_bridge ? 'Yes' : 'No'}`);
    console.log(`      Notes: ${r.notes}`);
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total CTFs documented: ${rows.length}`);
  console.log(`   Total shares: ${totalShares.toLocaleString()}`);
  console.log(`   Total estimated value: $${totalValue.toLocaleString()}\n`);

  console.log('✅ Permanent audit trail created\n');

  console.log('Use this table for:');
  console.log('   - Quarterly monitoring: SELECT * FROM default.unresolved_ctf_markets');
  console.log('   - Gap explanation: SUM(estimated_value_usd) = ~$14K');
  console.log('   - Audit documentation: reason_code shows why each cannot be resolved\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
