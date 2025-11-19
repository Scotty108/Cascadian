#!/usr/bin/env tsx
/**
 * ERC-1155 Coverage Debug - Resolve Unmapped Token Discrepancy
 *
 * Issue: Coverage shows 15.72% (41,305 / 262,775) but unmapped query returns 0.
 * This script investigates the root cause.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 ERC-1155 Coverage Discrepancy Debug');
  console.log('='.repeat(60));
  console.log('');

  // Step 0: Verify database context
  console.log('Step 0: Database context check...');
  const dbQuery = await clickhouse.query({
    query: 'SELECT currentDatabase() as db',
    format: 'JSONEachRow'
  });
  const dbResult = await dbQuery.json<{db: string}>();
  console.log(`Current database: ${dbResult[0].db}`);
  console.log('');

  // Step 1: Count distinct tokens in erc1155_transfers (raw)
  console.log('Step 1: Counting distinct tokens in erc1155_transfers (raw)...');

  const rawCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT token_id) as raw_distinct_tokens
      FROM erc1155_transfers
      WHERE token_id != ''
        AND token_id != '0x0'
        AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });
  const rawCount = await rawCountQuery.json<{raw_distinct_tokens: string}>();
  console.log(`Raw distinct tokens (with 0x, mixed case): ${rawCount[0].raw_distinct_tokens}`);
  console.log('');

  // Step 2: Count distinct tokens in erc1155_transfers (normalized)
  console.log('Step 2: Counting distinct tokens in erc1155_transfers (normalized)...');

  const normCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT lower(replaceAll(token_id, '0x', ''))) as normalized_distinct_tokens
      FROM erc1155_transfers
      WHERE token_id != ''
        AND token_id != '0x0'
        AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });
  const normCount = await normCountQuery.json<{normalized_distinct_tokens: string}>();
  console.log(`Normalized distinct tokens (no 0x, lowercase): ${normCount[0].normalized_distinct_tokens}`);
  console.log('');

  // Step 3: Count distinct tokens in pm_erc1155_token_map
  console.log('Step 3: Counting distinct tokens in pm_erc1155_token_map...');

  const mapCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT erc1155_token_id_hex) as mapped_tokens
      FROM pm_erc1155_token_map
    `,
    format: 'JSONEachRow'
  });
  const mapCount = await mapCountQuery.json<{mapped_tokens: string}>();
  console.log(`Mapped tokens in pm_erc1155_token_map: ${mapCount[0].mapped_tokens}`);
  console.log('');

  // Step 4: Direct comparison - normalized tokens vs mapped tokens
  console.log('Step 4: Direct set comparison...');
  console.log('');

  const setComparisonQuery = await clickhouse.query({
    query: `
      WITH
        normalized_tokens AS (
          SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) AS token_id_norm
          FROM erc1155_transfers
          WHERE token_id != ''
            AND token_id != '0x0'
            AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ),
        mapped_tokens AS (
          SELECT DISTINCT erc1155_token_id_hex
          FROM pm_erc1155_token_map
        )
      SELECT
        (SELECT COUNT(*) FROM normalized_tokens) as total_normalized,
        (SELECT COUNT(*) FROM mapped_tokens) as total_mapped,
        (SELECT COUNT(*) FROM normalized_tokens) - (SELECT COUNT(*) FROM mapped_tokens) as naive_gap
    `,
    format: 'JSONEachRow'
  });
  const setComp = await setComparisonQuery.json<{
    total_normalized: string;
    total_mapped: string;
    naive_gap: string;
  }>();

  console.log('Set Comparison:');
  console.table(setComp);
  console.log('');

  // Step 5: LEFT JOIN test - find unmapped tokens
  console.log('Step 5: LEFT JOIN test - finding unmapped tokens...');
  console.log('');

  const leftJoinQuery = await clickhouse.query({
    query: `
      WITH
        normalized_tokens AS (
          SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) AS token_id_norm
          FROM erc1155_transfers
          WHERE token_id != ''
            AND token_id != '0x0'
            AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
      SELECT
        COUNT(*) as total_tokens,
        SUM(CASE WHEN m.erc1155_token_id_hex IS NOT NULL THEN 1 ELSE 0 END) as mapped_count,
        SUM(CASE WHEN m.erc1155_token_id_hex IS NULL THEN 1 ELSE 0 END) as unmapped_count
      FROM normalized_tokens nt
      LEFT JOIN pm_erc1155_token_map m
        ON nt.token_id_norm = m.erc1155_token_id_hex
    `,
    format: 'JSONEachRow'
  });
  const leftJoin = await leftJoinQuery.json<{
    total_tokens: string;
    mapped_count: string;
    unmapped_count: string;
  }>();

  console.log('LEFT JOIN Results:');
  console.table(leftJoin);
  console.log('');

  // Step 6: Sample unmapped tokens (if any)
  console.log('Step 6: Sample of unmapped tokens...');
  console.log('');

  const unmappedSampleQuery = await clickhouse.query({
    query: `
      WITH
        normalized_tokens AS (
          SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) AS token_id_norm
          FROM erc1155_transfers
          WHERE token_id != ''
            AND token_id != '0x0'
            AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
      SELECT
        nt.token_id_norm,
        m.erc1155_token_id_hex as mapped_hex,
        CASE WHEN m.erc1155_token_id_hex IS NULL THEN 'UNMAPPED' ELSE 'MAPPED' END as status
      FROM normalized_tokens nt
      LEFT JOIN pm_erc1155_token_map m
        ON nt.token_id_norm = m.erc1155_token_id_hex
      WHERE m.erc1155_token_id_hex IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const unmappedSample = await unmappedSampleQuery.json<{
    token_id_norm: string;
    mapped_hex: string | null;
    status: string;
  }>();

  if (unmappedSample.length > 0) {
    console.log('First 10 Unmapped Tokens:');
    console.table(unmappedSample.map(t => ({
      token_id: t.token_id_norm.substring(0, 16) + '...',
      status: t.status
    })));
  } else {
    console.log('⚠️  NO UNMAPPED TOKENS FOUND in sample query');
  }
  console.log('');

  // Step 7: Check for length mismatches
  console.log('Step 7: Checking token ID length distribution...');
  console.log('');

  const lengthCheckQuery = await clickhouse.query({
    query: `
      SELECT
        length(lower(replaceAll(token_id, '0x', ''))) as token_length,
        COUNT(*) as count
      FROM erc1155_transfers
      WHERE token_id != ''
        AND token_id != '0x0'
        AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY token_length
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const lengthDist = await lengthCheckQuery.json<{
    token_length: string;
    count: string;
  }>();

  console.log('Token ID Length Distribution (normalized):');
  console.table(lengthDist);
  console.log('');

  const mapLengthQuery = await clickhouse.query({
    query: `
      SELECT
        length(erc1155_token_id_hex) as token_length,
        COUNT(*) as count
      FROM pm_erc1155_token_map
      GROUP BY token_length
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const mapLengthDist = await mapLengthQuery.json<{
    token_length: string;
    count: string;
  }>();

  console.log('Mapped Token ID Length Distribution:');
  console.table(mapLengthDist);
  console.log('');

  // Step 8: Cross-reference samples
  console.log('Step 8: Cross-referencing sample tokens...');
  console.log('');

  const sampleCrossRefQuery = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(et.token_id, '0x', '')) as transfers_norm,
        m.erc1155_token_id_hex as map_hex,
        CASE WHEN m.erc1155_token_id_hex IS NOT NULL THEN 'FOUND' ELSE 'MISSING' END as status
      FROM (
        SELECT DISTINCT token_id
        FROM erc1155_transfers
        WHERE token_id != ''
          AND token_id != '0x0'
          AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 20
      ) et
      LEFT JOIN pm_erc1155_token_map m
        ON lower(replaceAll(et.token_id, '0x', '')) = m.erc1155_token_id_hex
    `,
    format: 'JSONEachRow'
  });
  const sampleCross = await sampleCrossRefQuery.json<{
    transfers_norm: string;
    map_hex: string | null;
    status: string;
  }>();

  console.log('Sample Cross-Reference (first 20 tokens):');
  console.table(sampleCross.map(t => ({
    token_id: t.transfers_norm.substring(0, 16) + '...',
    in_map: t.status
  })));
  console.log('');

  // Final Analysis
  console.log('='.repeat(60));
  console.log('📋 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const rawTotal = parseInt(rawCount[0].raw_distinct_tokens);
  const normTotal = parseInt(normCount[0].normalized_distinct_tokens);
  const mappedTotal = parseInt(mapCount[0].mapped_tokens);
  const unmappedActual = parseInt(leftJoin[0].unmapped_count);

  console.log(`Raw tokens (erc1155_transfers, with 0x):     ${rawTotal.toLocaleString()}`);
  console.log(`Normalized tokens (no 0x, lowercase):        ${normTotal.toLocaleString()}`);
  console.log(`Mapped tokens (pm_erc1155_token_map):        ${mappedTotal.toLocaleString()}`);
  console.log(`Unmapped tokens (LEFT JOIN result):          ${unmappedActual.toLocaleString()}`);
  console.log('');

  const coveragePct = (mappedTotal / normTotal * 100).toFixed(2);
  console.log(`Calculated Coverage: ${mappedTotal} / ${normTotal} = ${coveragePct}%`);
  console.log('');

  // Diagnosis
  console.log('🔍 ROOT CAUSE ANALYSIS:');
  console.log('');

  if (unmappedActual === 0 && mappedTotal < normTotal) {
    console.log('❌ DISCREPANCY CONFIRMED:');
    console.log(`   - Expected unmapped: ${normTotal - mappedTotal}`);
    console.log(`   - Actual unmapped: ${unmappedActual}`);
    console.log('');
    console.log('Possible causes:');
    console.log('   1. All normalized tokens in erc1155_transfers are in pm_erc1155_token_map');
    console.log('   2. The 262,775 count includes non-normalized duplicates');
    console.log('   3. Query timing issue (data changed between queries)');
    console.log('   4. pm_erc1155_token_map has more tokens than erc1155_transfers');
  } else if (unmappedActual > 0) {
    console.log('✅ UNMAPPED TOKENS FOUND:');
    console.log(`   - Unmapped count: ${unmappedActual.toLocaleString()}`);
    console.log(`   - Coverage: ${coveragePct}%`);
  } else {
    console.log('⚠️  UNEXPECTED STATE:');
    console.log('   - Need further investigation');
  }
  console.log('');

  // Check if mapped > normalized (over-mapping)
  if (mappedTotal > normTotal) {
    console.log('⚠️  WARNING: pm_erc1155_token_map has MORE tokens than erc1155_transfers!');
    console.log(`   Difference: +${mappedTotal - normTotal}`);
    console.log('   This suggests the map includes tokens not observed in transfers.');
    console.log('');
  }

  console.log('✅ Diagnostic complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review diagnostic output above');
  console.log('  2. Update DATA_COVERAGE_REPORT_C1.md with correct numbers');
  console.log('  3. Proceed with v2 bridge expansion');
}

main().catch((error) => {
  console.error('❌ Diagnostic failed:', error);
  process.exit(1);
});
