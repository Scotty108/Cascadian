import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 4: VERIFY EMPTY PPS ARRAYS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get redemption CTF IDs and check their PPS status
  const query = await clickhouse.query({
    query: `
      WITH red AS (
        SELECT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS condition_id_ctf,
          toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      )
      SELECT
        r.condition_id_ctf,
        sum(r.shares) AS total_shares,
        t.pps,
        length(coalesce(t.pps, [])) AS pps_len,
        if(t.pps IS NULL, 'NULL', if(length(t.pps) = 0, 'EMPTY', 'HAS DATA')) AS status
      FROM red r
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = r.condition_id_ctf
      GROUP BY r.condition_id_ctf, t.pps
      ORDER BY total_shares DESC
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  console.log('Redemption CTF IDs and their PPS status:\n');

  let hasData = 0;
  let isEmpty = 0;
  let isNull = 0;

  results.forEach((r, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${r.condition_id_ctf.substring(0, 20)}...`);
    console.log(`    Shares: ${Number(r.total_shares).toLocaleString()}`);
    console.log(`    Status: ${r.status}`);

    if (r.status === 'HAS DATA') {
      hasData++;
      console.log(`    PPS: [${r.pps.slice(0, 4).join(', ')}${r.pps.length > 4 ? '...' : ''}]`);
    } else if (r.status === 'EMPTY') {
      isEmpty++;
      console.log(`    PPS: [] (empty array)`);
    } else {
      isNull++;
      console.log(`    PPS: NULL (no join match)`);
    }
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`   Total redemption CTF IDs: ${results.length}`);
  console.log(`   With data: ${hasData}`);
  console.log(`   Empty array: ${isEmpty}`);
  console.log(`   NULL (no match): ${isNull}\n`);

  if (isEmpty > 0) {
    console.log('⚠️  FINDING: Join is working, but PPS arrays are EMPTY');
    console.log('   This means:');
    console.log('   1. The CTF IDs exist in token_per_share_payout ✅');
    console.log('   2. But the resolution data (payout_numerators) is missing ❌');
    console.log('   3. This is a DATA problem, not a JOIN problem\n');
    console.log('   NEXT STEP: Backfill missing resolution data for these CTF IDs\n');
  } else if (isNull > 0) {
    console.log('⚠️  FINDING: Join is NOT working for some CTF IDs');
    console.log('   This means the 64-char standardization is incomplete.\n');
  } else {
    console.log('✅ PERFECT: All redemption CTF IDs have resolution data!\n');
  }

  // Cross-check: Do these CTF IDs have market_id mappings?
  if (isEmpty > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('CROSS-CHECK: Market ID Mappings');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const emptyCtfs = results.filter(r => r.status === 'EMPTY').map(r => r.condition_id_ctf);

    for (const ctf of emptyCtfs.slice(0, 5)) {
      const bridgeQuery = await clickhouse.query({
        query: `
          SELECT condition_id_market_hex64
          FROM ctf_to_market_bridge_mat
          WHERE condition_id_ctf_hex64 = '${ctf}'
        `,
        format: 'JSONEachRow'
      });
      const bridge = await bridgeQuery.json();

      if (bridge.length > 0) {
        console.log(`✅ ${ctf.substring(0, 20)}...`);
        console.log(`   Market ID: ${bridge[0].condition_id_market_hex64.substring(0, 20)}...`);

        // Check if this market_id has resolution data
        const resQuery = await clickhouse.query({
          query: `
            SELECT payout_numerators, payout_denominator
            FROM market_resolutions_final
            WHERE lower(condition_id_norm) = lower('${bridge[0].condition_id_market_hex64}')
          `,
          format: 'JSONEachRow'
        });
        const res = await resQuery.json();

        if (res.length > 0) {
          console.log(`   Resolution: [${res[0].payout_numerators.join(', ')}] / ${res[0].payout_denominator}`);
        } else {
          console.log(`   ❌ NO resolution data in market_resolutions_final`);
        }
      } else {
        console.log(`❌ ${ctf.substring(0, 20)}... - NO bridge mapping`);
      }
      console.log();
    }
  }
}

main().catch(console.error);
