import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 1: VERIFY KEY FORMATS IN SOURCE TABLES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check market_resolutions_final
  console.log('1. market_resolutions_final:');
  const mktResQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) AS len,
        payout_numerators
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const mktRes: any[] = await mktResQuery.json();

  mktRes.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.condition_id_norm.substring(0, 20)}... (${r.len} chars)`);
  });

  const allSameLength = mktRes.every(r => r.condition_id_norm.length === mktRes[0].condition_id_norm.length);
  console.log(`   All same length: ${allSameLength ? '✅ YES' : '❌ NO'}`);
  console.log(`   Format: ${mktRes[0].condition_id_norm.length}-char hex\n`);

  // Check clob_fills asset_id encoding
  console.log('2. clob_fills asset_id (as 64-char hex):');
  const clobQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS ctf_64,
        length(lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0')) AS len
      FROM clob_fills
      WHERE asset_id NOT IN ('asset', '')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const clob: any[] = await clobQuery.json();

  clob.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.ctf_64.substring(0, 20)}... (${c.len} chars)`);
  });
  console.log(`   Format: 64-char hex (left-padded)\n`);

  // Check erc1155_transfers token_id encoding
  console.log('3. erc1155_transfers token_id (as 64-char hex):');
  const ercQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_64,
        length(lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0')) AS len
      FROM erc1155_transfers
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const erc: any[] = await ercQuery.json();

  erc.forEach((e, i) => {
    console.log(`   ${i + 1}. ${e.ctf_64.substring(0, 20)}... (${e.len} chars)`);
  });
  console.log(`   Format: 64-char hex (left-padded)\n`);

  // Check current token_per_share_payout
  console.log('4. CURRENT token_per_share_payout:');
  const tpsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        length(condition_id_ctf) AS len
      FROM token_per_share_payout
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const tps: any[] = await tpsQuery.json();

  tps.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.condition_id_ctf.substring(0, 20)}... (${t.len} chars)`);
  });
  console.log(`   Format: ${tps[0].len}-char hex\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (mktRes[0].condition_id_norm.length === 64 && tps[0].len === 62) {
    console.log('⚠️  KEY MISMATCH FOUND!');
    console.log(`   market_resolutions_final uses: 64-char hex`);
    console.log(`   token_per_share_payout uses:   62-char hex`);
    console.log(`   This breaks the join!\n`);
    console.log('✅ SOLUTION: Standardize everything to 64-char hex\n');
  } else if (mktRes[0].condition_id_norm.length === tps[0].len) {
    console.log('✅ Keys match! Both use the same format.\n');
  } else {
    console.log(`⚠️  Unexpected format mismatch:`);
    console.log(`   market_resolutions_final: ${mktRes[0].condition_id_norm.length}-char`);
    console.log(`   token_per_share_payout:   ${tps[0].len}-char\n`);
  }
}

main().catch(console.error);
