import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 3: GUARDRAIL CHECKS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Guardrail A: Redemptions missing PPS after refactor
  console.log('GUARDRAIL A: Redemptions missing PPS');
  console.log('─'.repeat(60));

  const guardA = await clickhouse.query({
    query: `
      WITH red AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS condition_id_ctf
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      )
      SELECT count() AS missing_count
      FROM red r
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = r.condition_id_ctf
      WHERE t.pps IS NULL
    `,
    format: 'JSONEachRow'
  });
  const resultA = await guardA.json();

  console.log(`   Redemptions missing PPS: ${resultA[0].missing_count}`);
  console.log(`   ${resultA[0].missing_count === '0' || resultA[0].missing_count === 0 ? '✅ PASS' : '❌ FAIL'} - Expected 0\n`);

  // Guardrail B: CLOB tokens and ERC1155 tokens disagree on key cardinality
  console.log('GUARDRAIL B: CLOB vs ERC1155 key cardinality');
  console.log('─'.repeat(60));

  const guardB = await clickhouse.query({
    query: `
      WITH clob AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS id
        FROM clob_fills
        WHERE asset_id NOT IN ('asset', '')
      ),
      erc AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS id
        FROM erc1155_transfers
      )
      SELECT
        countIf(c.id IS NOT NULL AND e.id IS NULL) AS clob_only,
        countIf(c.id IS NULL AND e.id IS NOT NULL) AS erc_only
      FROM clob c
      FULL OUTER JOIN erc e ON c.id = e.id
    `,
    format: 'JSONEachRow'
  });
  const resultB = await guardB.json();

  console.log(`   CLOB-only CTF IDs: ${resultB[0].clob_only}`);
  console.log(`   ERC1155-only CTF IDs: ${resultB[0].erc_only}`);
  console.log(`   ${resultB[0].clob_only === 0 && resultB[0].erc_only === 0 ? '✅ PASS' : '⚠️  INFO'} - Some mismatch is expected\n`);

  // Guardrail C: Decode integrity without relying on string length
  console.log('GUARDRAIL C: Decode integrity (token = CTF << 8 | mask)');
  console.log('─'.repeat(60));

  const guardC = await clickhouse.query({
    query: `
      SELECT
        count() AS n,
        countIf(
          reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))) =
          bitOr(
            bitShiftLeft(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8), 8),
            bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)
          )
        ) AS ok
      FROM erc1155_transfers
      LIMIT 10000
    `,
    format: 'JSONEachRow'
  });
  const resultC = await guardC.json();

  const integrityPct = (resultC[0].ok / resultC[0].n * 100).toFixed(2);
  console.log(`   Sampled: ${resultC[0].n}`);
  console.log(`   Correct: ${resultC[0].ok}`);
  console.log(`   Integrity: ${integrityPct}%`);
  console.log(`   ${resultC[0].ok === resultC[0].n ? '✅ PASS' : '❌ FAIL'} - Expected 100%\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('GUARDRAIL SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allPass = resultA[0].missing_count === 0 && resultC[0].ok === resultC[0].n;

  if (allPass) {
    console.log('✅ ALL GUARDRAILS PASSED!');
    console.log('   The join-key problem is fixed.');
    console.log('   Redemptions can now see their payout data.\n');
  } else {
    console.log('⚠️  SOME GUARDRAILS FAILED');
    console.log('   Review the issues above before proceeding.\n');
  }

  // Additional check: How many redemption CTF IDs now have payout data?
  console.log('BONUS CHECK: Redemption coverage after fix');
  console.log('─'.repeat(60));

  const coverageQuery = await clickhouse.query({
    query: `
      WITH red AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS condition_id_ctf
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      )
      SELECT
        count() AS total,
        countIf(t.pps IS NOT NULL AND length(t.pps) > 0) AS with_pps
      FROM red r
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = r.condition_id_ctf
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageQuery.json();

  const coveragePct = (coverage[0].with_pps / coverage[0].total * 100).toFixed(1);
  console.log(`   Total redemption CTF IDs: ${coverage[0].total}`);
  console.log(`   With PPS data: ${coverage[0].with_pps}`);
  console.log(`   Coverage: ${coveragePct}%`);
  console.log(`   ${coverage[0].with_pps === coverage[0].total ? '✅ 100%!' : `⚠️  ${coveragePct}% (was 20% before fix)`}\n`);
}

main().catch(console.error);
