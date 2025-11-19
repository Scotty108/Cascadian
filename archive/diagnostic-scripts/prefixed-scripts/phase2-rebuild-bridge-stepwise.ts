import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 2: REBUILD BRIDGE (STEPWISE)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Create empty table
  console.log('Step 1: Creating bridge table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ctf_to_market_bridge_mat`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE ctf_to_market_bridge_mat
      (
        ctf_hex64         FixedString(64),
        market_hex64      FixedString(64),
        source            LowCardinality(String),
        vote_count        UInt32,
        created_at        DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (ctf_hex64, source)
    `
  });
  console.log('   ✅ Table created\n');

  // Step 2: Insert CLOB source
  console.log('Step 2: Inserting CLOB mappings...');
  await clickhouse.command({
    query: `
      INSERT INTO ctf_to_market_bridge_mat (ctf_hex64, market_hex64, source, vote_count)
      SELECT
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS ctf_hex64,
        lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS market_hex64,
        'clob' AS source,
        count() AS vote_count
      FROM clob_fills
      WHERE asset_id NOT IN ('asset', '')
        AND condition_id != ''
      GROUP BY ctf_hex64, market_hex64
    `
  });

  const clobCountQuery = await clickhouse.query({
    query: `SELECT count() AS cnt FROM ctf_to_market_bridge_mat WHERE source = 'clob'`,
    format: 'JSONEachRow'
  });
  const clobCount = await clobCountQuery.json();
  console.log(`   ✅ Inserted ${clobCount[0].cnt.toLocaleString()} CLOB mappings\n`);

  // Step 3: Insert ERC1155-only tokens with identity fallback
  console.log('Step 3: Inserting ERC1155-only tokens (identity fallback)...');
  await clickhouse.command({
    query: `
      INSERT INTO ctf_to_market_bridge_mat (ctf_hex64, market_hex64, source, vote_count)
      SELECT
        ctf_hex64,
        ctf_hex64 AS market_hex64,  -- Identity fallback
        'erc1155_identity' AS source,
        0 AS vote_count
      FROM (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64
        FROM erc1155_transfers
      ) e
      WHERE ctf_hex64 NOT IN (
        SELECT ctf_hex64 FROM ctf_to_market_bridge_mat
      )
    `
  });

  const ercCountQuery = await clickhouse.query({
    query: `SELECT count() AS cnt FROM ctf_to_market_bridge_mat WHERE source = 'erc1155_identity'`,
    format: 'JSONEachRow'
  });
  const ercCount = await ercCountQuery.json();
  console.log(`   ✅ Inserted ${ercCount[0].cnt.toLocaleString()} ERC1155-only tokens\n`);

  // Step 4: Verify coverage
  console.log('Step 4: Verifying coverage...\n');

  const totalQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM ctf_to_market_bridge_mat`,
    format: 'JSONEachRow'
  });
  const total = await totalQuery.json();
  console.log(`   Total bridge entries: ${total[0].total.toLocaleString()}\n`);

  // Check by source
  const sourceQuery = await clickhouse.query({
    query: `
      SELECT
        source,
        count() AS cnt,
        round(cnt * 100.0 / (SELECT count() FROM ctf_to_market_bridge_mat), 2) AS pct
      FROM ctf_to_market_bridge_mat
      GROUP BY source
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const sources: any[] = await sourceQuery.json();

  console.log('   Breakdown by source:');
  sources.forEach(s => {
    console.log(`      ${s.source.padEnd(20)} ${String(s.cnt).padStart(10)} (${s.pct}%)`);
  });
  console.log();

  // Check CLOB coverage
  const clobCoverageQuery = await clickhouse.query({
    query: `
      WITH clob_ctfs AS (
        SELECT DISTINCT lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS ctf_hex64
        FROM clob_fills
        WHERE asset_id NOT IN ('asset', '')
      )
      SELECT
        (SELECT count() FROM clob_ctfs) AS total_clob,
        (SELECT count() FROM clob_ctfs c JOIN ctf_to_market_bridge_mat b USING (ctf_hex64)) AS covered,
        round(covered * 100.0 / total_clob, 2) AS pct
    `,
    format: 'JSONEachRow'
  });
  const clobCoverage = await clobCoverageQuery.json();

  console.log('   CLOB CTF coverage:');
  console.log(`      Total: ${clobCoverage[0].total_clob}`);
  console.log(`      Covered: ${clobCoverage[0].covered} (${clobCoverage[0].pct}%)`);
  console.log(`      ${Number(clobCoverage[0].pct) === 100 ? '✅' : '⚠️ '} ${Number(clobCoverage[0].pct) === 100 ? 'Complete' : 'Incomplete'}\n`);

  // Check ERC1155 coverage
  const ercCoverageQuery = await clickhouse.query({
    query: `
      WITH erc_ctfs AS (
        SELECT DISTINCT lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64
        FROM erc1155_transfers
      )
      SELECT
        (SELECT count() FROM erc_ctfs) AS total_erc,
        (SELECT count() FROM erc_ctfs e JOIN ctf_to_market_bridge_mat b USING (ctf_hex64)) AS covered,
        round(covered * 100.0 / total_erc, 2) AS pct
    `,
    format: 'JSONEachRow'
  });
  const ercCoverage = await ercCoverageQuery.json();

  console.log('   ERC1155 CTF coverage:');
  console.log(`      Total: ${ercCoverage[0].total_erc}`);
  console.log(`      Covered: ${ercCoverage[0].covered} (${ercCoverage[0].pct}%)`);
  console.log(`      ${Number(ercCoverage[0].pct) === 100 ? '✅' : '⚠️ '} ${Number(ercCoverage[0].pct) === 100 ? 'Complete' : 'Incomplete'}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 2 ACCEPTANCE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allPass = Number(clobCoverage[0].pct) === 100 && Number(ercCoverage[0].pct) === 100;

  if (allPass) {
    console.log('✅ Bridge covers 100% of CLOB and ERC1155 CTF IDs');
    console.log('✅ Identity fallback applied for ERC1155-only tokens');
    console.log('✅ PHASE 2 COMPLETE\n');
  } else {
    console.log('⚠️  Coverage incomplete - review the gaps above\n');
  }
}

main().catch(console.error);
