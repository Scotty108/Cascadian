import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DEBUG: WHY ARE REDEMPTION PAYOUTS $0?');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get decoded redemption data with payout join info
  const debugQuery = await clickhouse.query({
    query: `
      WITH redemptions AS (
        SELECT
          token_id,
          toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares_redeemed,
          block_timestamp
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      ),
      decoded AS (
        SELECT
          r.token_id,
          r.shares_redeemed,
          r.block_timestamp,
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 8))), 62, '0') AS condition_id_ctf,
          toUInt16(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 255)) AS index_set_mask
        FROM redemptions r
      )
      SELECT
        d.token_id,
        d.condition_id_ctf,
        d.index_set_mask,
        d.shares_redeemed,
        d.block_timestamp,
        t.pps,
        if(t.pps IS NULL, 'NO MATCH', 'HAS PAYOUT') AS payout_status,
        length(coalesce(t.pps, [])) AS pps_length
      FROM decoded d
      LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      ORDER BY d.shares_redeemed DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await debugQuery.json();

  console.log('Top Redemptions by Share Count:\n');
  results.forEach((r, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${r.shares_redeemed.toLocaleString()} shares`);
    console.log(`    CTF ID: ${r.condition_id_ctf.substring(0, 20)}...`);
    console.log(`    Mask: ${r.index_set_mask}`);
    console.log(`    Payout Status: ${r.payout_status}`);
    if (r.pps_length > 0) {
      console.log(`    PPS Array: [${r.pps.slice(0, 4).join(', ')}${r.pps.length > 4 ? '...' : ''}]`);
    }
    console.log(`    Date: ${r.block_timestamp}`);
    console.log();
  });

  // Count how many have payouts vs don't
  const withPayouts = results.filter(r => r.payout_status === 'HAS PAYOUT').length;
  const withoutPayouts = results.filter(r => r.payout_status === 'NO MATCH').length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`   Redemptions WITH payout data: ${withPayouts}`);
  console.log(`   Redemptions WITHOUT payout data: ${withoutPayouts}`);
  console.log(`   Match rate: ${(withPayouts / results.length * 100).toFixed(1)}%\n`);

  // Check if these CTF IDs exist in token_per_share_payout AT ALL
  console.log('Checking if these CTF IDs exist in token_per_share_payout...\n');

  const missingIds = results
    .filter(r => r.payout_status === 'NO MATCH')
    .map(r => r.condition_id_ctf);

  if (missingIds.length > 0) {
    console.log(`Checking ${missingIds.length} missing CTF IDs:\n`);

    for (const ctfId of missingIds.slice(0, 5)) {
      const checkQuery = await clickhouse.query({
        query: `
          SELECT count() AS exists_count
          FROM token_per_share_payout
          WHERE condition_id_ctf = '${ctfId}'
        `,
        format: 'JSONEachRow'
      });
      const check = await checkQuery.json();
      console.log(`   ${ctfId.substring(0, 20)}... exists: ${check[0].exists_count > 0 ? '✅ YES' : '❌ NO'}`);
    }
  }

  // Also check what the CTF ID SHOULD look like - maybe it's a format issue
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CTF ID FORMAT CHECK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const formatQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        length(condition_id_ctf) AS len,
        pps
      FROM token_per_share_payout
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const formats: any[] = await formatQuery.json();

  console.log('Sample CTF IDs from token_per_share_payout:\n');
  formats.forEach((f, i) => {
    console.log(`   ${(i + 1)}. ${f.condition_id_ctf}`);
    console.log(`      Length: ${f.len} chars`);
    console.log(`      PPS: [${f.pps.slice(0, 3).join(', ')}...]`);
    console.log();
  });
}

main().catch(console.error);
