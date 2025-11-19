import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.11: CHECK BOTH DATABASES FOR MISSING CTFs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Checking THREE bridge tables across BOTH databases...\n');

  // Query all three bridge tables with CORRECT column names
  const query = `
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
    SELECT 'api_ctf_bridge' AS src,
           a.condition_id,
           a.api_market_id AS slug,
           a.resolved_outcome,
           a.resolved_at
    FROM default.api_ctf_bridge a
    JOIN miss ON lower(replaceAll(a.condition_id,'0x','')) = miss.ctf_64

    UNION ALL

    SELECT 'token_to_cid_bridge' AS src,
           lower(replaceAll(t.cid_hex,'0x','')) AS condition_id,
           k.market_id AS slug,
           NULL AS resolved_outcome,
           NULL AS resolved_at
    FROM cascadian_clean.token_to_cid_bridge t
    LEFT JOIN default.market_key_map k ON lower(replaceAll(k.condition_id,'0x','')) = lower(replaceAll(t.cid_hex,'0x',''))
    JOIN miss ON lower(replaceAll(t.token_hex,'0x','')) = miss.ctf_64

    UNION ALL

    SELECT 'ctf_to_market_bridge_mat' AS src,
           b.market_hex64 AS condition_id,
           k.market_id AS slug,
           NULL AS resolved_outcome,
           NULL AS resolved_at
    FROM default.ctf_to_market_bridge_mat b
    LEFT JOIN default.market_key_map k ON lower(replaceAll(k.condition_id,'0x','')) = lower(b.market_hex64)
    JOIN miss ON lower(b.ctf_hex64) = miss.ctf_64

    ORDER BY src
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows: any[] = await result.json();

  console.log(`Found ${rows.length} mappings across all bridge tables\n`);

  if (rows.length === 0) {
    console.log('❌ No mappings found in any bridge table\n');
    console.log('This confirms these CTF IDs were never bridged to market IDs.\n');
  } else {
    console.log('Bridge mappings found:\n');

    rows.forEach((r, i) => {
      console.log(`${i + 1}. Source: ${r.src}`);
      console.log(`   Condition ID: ${r.condition_id?.substring(0, 20)}...`);
      console.log(`   Slug: ${r.slug || 'NULL'}`);
      console.log(`   Resolved outcome: ${r.resolved_outcome || 'NULL'}`);
      console.log(`   Resolved at: ${r.resolved_at || 'NULL'}`);
      console.log();
    });

    // Check which have resolutions available
    const withSlugs = rows.filter(r => r.slug);
    console.log(`Rows with slugs: ${withSlugs.length}\n`);

    if (withSlugs.length > 0) {
      console.log('Checking for resolution data...\n');

      for (const row of withSlugs) {
        const resQuery = await clickhouse.query({
          query: `
            SELECT outcome, resolved_at
            FROM default.market_resolutions_by_market
            WHERE slug = '${row.slug}'
          `,
          format: 'JSONEachRow'
        });

        const resData: any[] = await resQuery.json();

        if (resData.length > 0) {
          console.log(`✅ Slug "${row.slug}" has resolution data:`);
          console.log(`   Outcome: ${resData[0].outcome}`);
          console.log(`   Resolved at: ${resData[0].resolved_at}`);
          console.log(`   Can insert this resolution!\n`);
        } else {
          console.log(`⚠️  Slug "${row.slug}" has NO resolution data\n`);
        }
      }
    }
  }

  // Now check burns
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CHECKING BURNS FOR THESE CTFs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const burnQuery = `
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
    SELECT
      lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(token_id))), 8))) AS ctf_64,
      sum(CAST(value AS Float64)) AS burned_amount,
      max(block_time) AS last_burn_time
    FROM default.pm_erc1155_flats
    WHERE lower(from_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      AND lower(to_address) = '0x0000000000000000000000000000000000000000'
    GROUP BY ctf_64
    HAVING ctf_64 IN (SELECT ctf_64 FROM miss)
  `;

  try {
    const burnResult = await clickhouse.query({
      query: burnQuery,
      format: 'JSONEachRow'
    });

    const burns: any[] = await burnResult.json();

    console.log(`Found ${burns.length} CTFs with burns\n`);

    if (burns.length > 0) {
      burns.forEach((b, i) => {
        console.log(`${i + 1}. CTF: ${b.ctf_64.substring(0, 20)}...`);
        console.log(`   Burned amount: ${parseFloat(b.burned_amount).toLocaleString()}`);
        console.log(`   Last burn: ${b.last_burn_time}`);
        console.log();
      });
    }
  } catch (error) {
    console.log(`Error checking burns: ${error.message}`);
    console.log('Will try simpler approach...\n');

    // Simpler approach without complex bit shifting
    const simpleBurnQuery = `
      SELECT
        token_id,
        sum(CAST(value AS Float64)) AS burned_amount,
        max(block_time) AS last_burn_time
      FROM default.pm_erc1155_flats
      WHERE lower(from_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        AND lower(to_address) = '0x0000000000000000000000000000000000000000'
      GROUP BY token_id
      ORDER BY burned_amount DESC
      LIMIT 20
    `;

    const simpleResult = await clickhouse.query({
      query: simpleBurnQuery,
      format: 'JSONEachRow'
    });

    const simpleBurns: any[] = await simpleResult.json();

    console.log('Top burns by amount (will decode manually):\n');
    simpleBurns.forEach((b, i) => {
      console.log(`${i + 1}. Token ID: ${b.token_id}`);
      console.log(`   Burned: ${parseFloat(b.burned_amount).toLocaleString()}`);
      console.log(`   Last burn: ${b.last_burn_time}`);
      console.log();
    });
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (rows.length > 0) {
    console.log(`✅ Found ${rows.length} bridge mappings`);
    const withResolution = rows.filter(r => r.resolved_outcome || r.slug);
    console.log(`   ${withResolution.length} with potential resolution data\n`);

    console.log('Next step: Insert resolutions for mapped CTFs\n');
  } else {
    console.log('❌ No bridge mappings found');
    console.log('These CTFs were never linked to market IDs in our system.\n');
    console.log('They represent genuinely unmapped positions.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
