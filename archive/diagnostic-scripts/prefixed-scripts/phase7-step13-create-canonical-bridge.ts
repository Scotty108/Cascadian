import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.13: CREATE CANONICAL BRIDGE VIEW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Check current database
  console.log('Step 1: Checking current database...\n');

  const currentDb = await clickhouse.query({
    query: `SELECT currentDatabase() AS db`,
    format: 'JSONEachRow'
  });
  const dbResult: any[] = await currentDb.json();
  console.log(`   Current database: ${dbResult[0].db}\n`);

  // Step 2: Inventory tables
  console.log('Step 2: Inventory of bridge tables...\n');

  const inventory = await clickhouse.query({
    query: `
      SELECT database, name
      FROM system.tables
      WHERE name IN (
        'api_ctf_bridge','token_to_cid_bridge','ctf_to_market_bridge_mat',
        'market_key_map','market_resolutions_by_market'
      )
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await inventory.json();
  console.log('   Tables found:');
  tables.forEach(t => console.log(`   - ${t.database}.${t.name}`));

  // Step 3: Create canonical bridge view
  console.log('\n\nStep 3: Creating canonical bridge view...\n');

  const createViewSQL = `
    CREATE OR REPLACE VIEW cascadian_clean.bridge_ctf_condition AS
    WITH
    mkm AS (
      SELECT lower(replaceAll(condition_id,'0x','')) AS condition_id_64, market_id AS slug
      FROM default.market_key_map
    )
    SELECT
      lower(replaceAll(a.condition_id,'0x',''))           AS ctf_64,
      lower(replaceAll(a.condition_id,'0x',''))           AS condition_id_64,
      a.api_market_id                                     AS slug,
      'api_ctf_bridge.default'                            AS src
    FROM default.api_ctf_bridge a

    UNION ALL
    SELECT
      lower(b.ctf_hex64),
      lower(b.market_hex64)                                AS condition_id_64,
      k.slug                                               AS slug,
      'ctf_to_market_bridge_mat.default'
    FROM default.ctf_to_market_bridge_mat b
    LEFT JOIN mkm k ON k.condition_id_64 = lower(b.market_hex64)

    UNION ALL
    SELECT
      lower(replaceAll(t.token_hex,'0x',''))               AS ctf_64,
      lower(replaceAll(t.cid_hex,'0x',''))                 AS condition_id_64,
      k.slug,
      'token_to_cid_bridge.cascadian_clean'
    FROM cascadian_clean.token_to_cid_bridge t
    LEFT JOIN mkm k ON k.condition_id_64 = lower(replaceAll(t.cid_hex,'0x',''))
  `;

  await clickhouse.command({ query: createViewSQL });

  console.log('   ✅ View created: cascadian_clean.bridge_ctf_condition\n');

  // Step 4: Query for the 5 missing CTFs
  console.log('Step 4: Querying canonical bridge for 5 missing CTFs...\n');

  const missingCtfsQuery = `
    WITH miss AS (
      SELECT *
      FROM (
        SELECT '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48' AS ctf_64
        UNION ALL SELECT '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af'
        UNION ALL SELECT '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb'
        UNION ALL SELECT '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22'
        UNION ALL SELECT '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
      )
    )
    SELECT b.src, b.ctf_64, b.condition_id_64, b.slug
    FROM cascadian_clean.bridge_ctf_condition b
    JOIN miss ON b.ctf_64 = miss.ctf_64
    ORDER BY src
  `;

  const bridgeResults = await clickhouse.query({
    query: missingCtfsQuery,
    format: 'JSONEachRow'
  });

  const bridges: any[] = await bridgeResults.json();

  console.log(`   Found ${bridges.length} mappings in canonical bridge\n`);

  if (bridges.length === 0) {
    console.log('   ❌ No mappings found. These CTFs were never bridged.\n');
    return;
  }

  bridges.forEach((b, i) => {
    console.log(`   ${i + 1}. Source: ${b.src}`);
    console.log(`      CTF: ${b.ctf_64.substring(0, 20)}...`);
    console.log(`      Condition ID: ${b.condition_id_64.substring(0, 20)}...`);
    console.log(`      Slug: ${b.slug || 'NULL'}`);
    console.log();
  });

  // Step 5: Check for resolution data
  const withSlugs = bridges.filter(b => b.slug);
  console.log(`\nStep 5: CTFs with slugs: ${withSlugs.length} / ${bridges.length}\n`);

  if (withSlugs.length === 0) {
    console.log('   ❌ No slugs found. Cannot resolve any of these CTFs.\n');
    return;
  }

  console.log('Checking for resolution data...\n');

  for (const bridge of withSlugs) {
    const resQuery = await clickhouse.query({
      query: `
        SELECT outcome, resolved_at
        FROM default.market_resolutions_by_market
        WHERE market_id = '${bridge.slug}'
      `,
      format: 'JSONEachRow'
    });

    const resData: any[] = await resQuery.json();

    if (resData.length > 0) {
      console.log(`   ✅ Slug "${bridge.slug}"`);
      console.log(`      CTF: ${bridge.ctf_64.substring(0, 20)}...`);
      console.log(`      Outcome: ${resData[0].outcome}`);
      console.log(`      Resolved at: ${resData[0].resolved_at}`);
      console.log(`      CAN INSERT RESOLUTION!\n`);
    } else {
      console.log(`   ⚠️  Slug "${bridge.slug}"`);
      console.log(`      CTF: ${bridge.ctf_64.substring(0, 20)}...`);
      console.log(`      NO resolution data\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total CTFs: 5`);
  console.log(`   Found in bridge: ${bridges.length}`);
  console.log(`   With slugs: ${withSlugs.length}`);
  console.log(`   Ready to resolve: ${withSlugs.filter(b => b.slug).length}\n`);

  if (withSlugs.length > 0) {
    console.log('   Next: Run phase7-step14-insert-resolutions.ts\n');
  } else {
    console.log('   ❌ No resolutions available to insert.\n');
    console.log('   These markets have never resolved.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
