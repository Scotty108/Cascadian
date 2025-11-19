import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CTF ID FORMAT COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get one redemption CTF ID
  const redemptionQuery = await clickhouse.query({
    query: `
      WITH redemptions AS (
        SELECT token_id
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
        LIMIT 1
      )
      SELECT
        token_id,
        lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 62, '0') AS ctf_from_erc1155,
        toUInt16(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)) AS mask_from_erc1155
      FROM redemptions
    `,
    format: 'JSONEachRow'
  });
  const redemption = (await redemptionQuery.json())[0];

  console.log('FROM ERC1155 TRANSFER:');
  console.log(`   Token ID: ${redemption.token_id}`);
  console.log(`   CTF ID (decoded): ${redemption.ctf_from_erc1155}`);
  console.log(`   Mask: ${redemption.mask_from_erc1155}`);
  console.log(`   CTF length: ${redemption.ctf_from_erc1155.length} chars\n`);

  // Get CTF ID from clob_fills for the same token
  const clobQuery = await clickhouse.query({
    query: `
      SELECT
        lower(hex(toUInt256(asset_id))) AS token_hex,
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 62, '0') AS ctf_from_clob,
        toUInt16(bitAnd(toUInt256(asset_id), 255)) AS mask_from_clob
      FROM clob_fills
      WHERE asset_id NOT IN ('asset', '')
        AND lower(user_eoa) = lower('${wallet}')
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const clob = (await clobQuery.json())[0];

  console.log('FROM CLOB FILLS:');
  console.log(`   Token ID: ${clob.token_hex}`);
  console.log(`   CTF ID (decoded): ${clob.ctf_from_clob}`);
  console.log(`   Mask: ${clob.mask_from_clob}`);
  console.log(`   CTF length: ${clob.ctf_from_clob.length} chars\n`);

  // Get CTF ID from token_per_share_payout
  const payoutQuery = await clickhouse.query({
    query: `
      SELECT condition_id_ctf, length(condition_id_ctf) AS len
      FROM token_per_share_payout
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const payout = (await payoutQuery.json())[0];

  console.log('FROM token_per_share_payout:');
  console.log(`   CTF ID: ${payout.condition_id_ctf}`);
  console.log(`   CTF length: ${payout.len} chars\n`);

  // Now check if the redemption CTF ID matches format in token_per_share_payout
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MATCHING TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const testQuery = await clickhouse.query({
    query: `
      SELECT count() AS match_count
      FROM token_per_share_payout
      WHERE condition_id_ctf = '${redemption.ctf_from_erc1155}'
    `,
    format: 'JSONEachRow'
  });
  const test = (await testQuery.json())[0];

  console.log(`Checking if redemption CTF "${redemption.ctf_from_erc1155.substring(0, 20)}..." exists in token_per_share_payout:`);
  console.log(`   Match count: ${test.match_count}`);
  console.log(`   ${test.match_count > 0 ? '✅ FOUND' : '❌ NOT FOUND'}\n`);

  // Check with different lengths
  console.log('Testing different CTF ID lengths:\n');

  const ctf62 = redemption.ctf_from_erc1155;
  const ctf64 = redemption.ctf_from_erc1155 + redemption.mask_from_erc1155.toString(16).padStart(2, '0');

  for (const [label, ctf] of [['62 chars', ctf62], ['64 chars (CTF+mask)', ctf64]]) {
    const lengthQuery = await clickhouse.query({
      query: `
        SELECT count() AS match_count
        FROM token_per_share_payout
        WHERE condition_id_ctf = '${ctf}'
      `,
      format: 'JSONEachRow'
    });
    const result = (await lengthQuery.json())[0];
    console.log(`   ${label} (${ctf.length}): ${ctf.substring(0, 20)}... ${result.match_count > 0 ? '✅' : '❌'} (${result.match_count} matches)`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (test.match_count === 0) {
    console.log('⚠️  The CTF IDs from ERC1155 transfers do NOT match the format in token_per_share_payout!\n');
    console.log('Possible causes:');
    console.log('   1. Endianness issue (big vs little endian)');
    console.log('   2. Byte order in hex decoding');
    console.log('   3. token_per_share_payout uses a different ID format\n');
    console.log('NEXT STEP: Check how token_per_share_payout is populated');
  } else {
    console.log('✅ CTF ID formats match!\n');
  }
}

main().catch(console.error);
