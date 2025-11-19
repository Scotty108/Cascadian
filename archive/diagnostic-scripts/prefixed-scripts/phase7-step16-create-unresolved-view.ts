import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.16: CREATE UNRESOLVED CTF MARKETS VIEW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Creating view to document the 5 unresolved CTFs...\n');

  const createViewSQL = `
    CREATE OR REPLACE VIEW default.unresolved_ctf_markets AS
    SELECT
      b.ctf_64,
      b.condition_id_64,
      b.slug,
      CASE
        WHEN b.slug IS NULL THEN 'no_slug_bridge'
        WHEN r.market_id IS NULL THEN 'no_resolution_data'
        ELSE 'unknown'
      END AS reason_code,
      b.src AS bridge_source
    FROM cascadian_clean.bridge_ctf_condition b
    LEFT JOIN default.market_resolutions_by_market r ON r.market_id = b.slug
    WHERE b.ctf_64 IN (
      '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
      '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
      '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
      '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
      '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
    )
    AND (b.slug IS NULL OR r.market_id IS NULL)
  `;

  await clickhouse.command({ query: createViewSQL });

  console.log('   ✅ View created: default.unresolved_ctf_markets\n');

  // Query the view
  console.log('Querying the view...\n');

  const query = await clickhouse.query({
    query: `SELECT * FROM default.unresolved_ctf_markets ORDER BY ctf_64`,
    format: 'JSONEachRow'
  });

  const rows: any[] = await query.json();

  console.log(`   Found ${rows.length} unresolved CTFs\n`);

  rows.forEach((r, i) => {
    console.log(`   ${i + 1}. CTF: ${r.ctf_64.substring(0, 20)}...`);
    console.log(`      Condition ID: ${r.condition_id_64?.substring(0, 20) || 'NULL'}...`);
    console.log(`      Slug: ${r.slug || 'NULL'}`);
    console.log(`      Reason: ${r.reason_code}`);
    console.log(`      Bridge source: ${r.bridge_source || 'NOT IN BRIDGE'}`);
    console.log();
  });

  // Also add the missing one (00a972af) that's not in bridge at all
  console.log('Note: CTF 00a972afa513fbe4fd5a... is NOT in any bridge table.\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('✅ Created audit view: default.unresolved_ctf_markets\n');
  console.log('This view documents:');
  console.log('   - Which CTFs cannot be resolved');
  console.log('   - Why they cannot be resolved (reason_code)');
  console.log('   - What bridge data exists (if any)\n');

  console.log('Use for:');
  console.log('   - Quarterly monitoring');
  console.log('   - Audit trail');
  console.log('   - Documentation of the gap\n');

  console.log('Query example:');
  console.log('   SELECT * FROM default.unresolved_ctf_markets;\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
