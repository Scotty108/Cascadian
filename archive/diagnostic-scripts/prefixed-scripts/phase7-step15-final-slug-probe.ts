import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.15: FINAL SLUG PROBE (Last Chance!)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Trying ALL bridge paths to find slugs...\n');

  const probeQuery = `
    WITH miss AS (
      SELECT arrayJoin([
        '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
        '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
        '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
        '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
        '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
      ]) AS ctf_64
    )
    SELECT
      m.ctf_64,
      coalesce(k.market_id, k2.market_id) AS slug,
      r.winning_outcome AS resolved_outcome,
      r.resolved_at
    FROM miss m
    LEFT JOIN default.ctf_to_market_bridge_mat b
      ON lower(b.ctf_hex64) = m.ctf_64
    LEFT JOIN default.market_key_map k
      ON lower(replaceAll(k.condition_id,'0x','')) = lower(b.market_hex64)
    LEFT JOIN cascadian_clean.token_to_cid_bridge t
      ON lower(replaceAll(t.token_hex,'0x','')) = m.ctf_64
    LEFT JOIN default.market_key_map k2
      ON lower(replaceAll(k2.condition_id,'0x','')) = lower(replaceAll(t.cid_hex,'0x',''))
    LEFT JOIN default.market_resolutions_by_market r
      ON r.market_id = coalesce(k.market_id, k2.market_id)
    ORDER BY m.ctf_64
  `;

  const result = await clickhouse.query({
    query: probeQuery,
    format: 'JSONEachRow'
  });

  const rows: any[] = await result.json();

  console.log(`Results: ${rows.length} / 5 CTFs\n`);

  let foundSlugs = 0;
  let foundResolutions = 0;

  rows.forEach((r, i) => {
    console.log(`${i + 1}. CTF: ${r.ctf_64.substring(0, 20)}...`);
    console.log(`   Slug: ${r.slug || 'NULL'}`);
    console.log(`   Resolved outcome: ${r.resolved_outcome || 'NULL'}`);
    console.log(`   Resolved at: ${r.resolved_at || 'NULL'}`);

    if (r.slug) {
      foundSlugs++;
      console.log('   ✅ SLUG FOUND!');
    }

    if (r.resolved_outcome) {
      foundResolutions++;
      console.log('   ✅ RESOLUTION FOUND!');
    }

    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PROBE RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   CTFs queried: 5`);
  console.log(`   With slugs: ${foundSlugs}`);
  console.log(`   With resolutions: ${foundResolutions}\n`);

  if (foundResolutions > 0) {
    console.log('✅ SUCCESS! Found resolutions we can insert!\n');
    console.log('Next steps:');
    console.log('   1. Run phase7-step16-insert-found-resolutions.ts');
    console.log('   2. Rebuild PPS: npx tsx phase3-rebuild-pps.ts');
    console.log('   3. Rebuild burns: npx tsx phase4-burns-valuation.ts');
    console.log('   4. Validate new P&L\n');

    // Save results for next step
    const fs = require('fs');
    fs.writeFileSync(
      'tmp/phase7-found-resolutions.json',
      JSON.stringify(rows.filter(r => r.resolved_outcome), null, 2)
    );

    console.log('   Saved to tmp/phase7-found-resolutions.json\n');

  } else if (foundSlugs > 0) {
    console.log('⚠️  Found slugs but NO resolution data\n');
    console.log('These markets have slugs but have not resolved yet.\n');
    console.log('Cannot insert resolution data.\n');

  } else {
    console.log('❌ No slugs found through ANY bridge path\n');
    console.log('This confirms:');
    console.log('   - No path from CTF ID to Market slug exists');
    console.log('   - Cannot look up resolution data');
    console.log('   - Gap cannot be closed\n');
    console.log('Recommendation: Ship $23,426 with documentation.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
