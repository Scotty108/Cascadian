#!/usr/bin/env tsx
/**
 * Create pm_erc1155_token_map_hex - ERC-1155 Hex Token Bridge
 *
 * This is for AUDIT/VERIFICATION ONLY with limited coverage (~6.5%).
 * Built from legacy_token_condition_map.
 * For primary analytics, use pm_asset_token_map instead.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Creating pm_erc1155_token_map_hex (ERC-1155 Hex Bridge)');
  console.log('='.repeat(60));
  console.log('');
  console.log('⚠️  Note: This is for AUDIT ONLY with ~6.5% coverage');
  console.log('   For primary analytics, use pm_asset_token_map (100% coverage)');
  console.log('');

  // Step 1: Create table
  console.log('Step 1: Creating table schema...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_erc1155_token_map_hex (
        -- Token Identification (On-Chain ERC-1155)
        erc1155_token_id_hex    String,        -- Normalized: no 0x, lowercase, 64 chars

        -- Canonical Anchors
        condition_id            String,        -- Normalized: no 0x, lowercase, 64 chars
        outcome_index           UInt8,         -- 0 for legacy 1:1 mapping (unknown outcome)
        outcome_label           String,        -- Empty for legacy data

        -- Metadata
        question                String,        -- Market question (if available)
        market_slug             String,        -- Market slug (if available)

        -- Event Metadata (for debugging and temporal analysis)
        first_seen_block        UInt64,        -- First block where this token appeared
        first_seen_timestamp    DateTime,      -- Timestamp of first appearance
        first_seen_tx           String,        -- Transaction hash of first appearance

        -- Source Tracking
        mapping_source          String,        -- 'legacy_token_condition_map'
        mapping_confidence      UInt8,         -- 0-100, higher = more reliable

        -- Housekeeping
        created_at              DateTime DEFAULT now(),
        updated_at              DateTime DEFAULT now()

      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (erc1155_token_id_hex, condition_id);
    `
  });

  console.log('✅ Table created');
  console.log('');

  // Step 2: Build mappings from legacy_token_condition_map
  console.log('Step 2: Building mappings from legacy_token_condition_map...');
  console.log('');

  await clickhouse.command({
    query: `
      INSERT INTO pm_erc1155_token_map_hex
      SELECT
        lower(replaceAll(ltcm.token_id, '0x', '')) as erc1155_token_id_hex,
        lower(replaceAll(ltcm.condition_id, '0x', '')) as condition_id,

        -- Legacy markets use 1:1 token=condition (no outcome encoding)
        0 as outcome_index,
        '' as outcome_label,

        -- Metadata from legacy_token_condition_map
        coalesce(ltcm.question, '') as question,
        coalesce(ltcm.market_slug, '') as market_slug,

        -- Event metadata from erc1155_transfers
        min(et.block_number) as first_seen_block,
        min(et.block_timestamp) as first_seen_timestamp,
        argMin(et.tx_hash, et.block_number) as first_seen_tx,

        -- Source tracking
        'legacy_token_condition_map' as mapping_source,
        90 as mapping_confidence,  -- High confidence for direct legacy mapping

        now() as created_at,
        now() as updated_at

      FROM legacy_token_condition_map ltcm
      LEFT JOIN erc1155_transfers et
        ON lower(replaceAll(et.token_id, '0x', '')) = lower(replaceAll(ltcm.token_id, '0x', ''))
      WHERE ltcm.token_id != ''
        AND ltcm.token_id != '0x0'
        AND ltcm.condition_id != ''
      GROUP BY
        ltcm.token_id,
        ltcm.condition_id,
        ltcm.question,
        ltcm.market_slug
    `
  });

  console.log('✅ Mappings built');
  console.log('');

  // Step 3: Statistics
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_mappings,
        COUNT(DISTINCT erc1155_token_id_hex) as distinct_tokens,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(CASE WHEN question != '' THEN 1 END) as with_question,
        COUNT(CASE WHEN market_slug != '' THEN 1 END) as with_market_slug,
        COUNT(CASE WHEN first_seen_block > 0 THEN 1 END) as with_event_metadata
      FROM pm_erc1155_token_map_hex
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_erc1155_token_map_hex Statistics:');
  console.table(stats);
  console.log('');

  // Step 4: Sample rows
  console.log('Step 4: Sample mappings...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(erc1155_token_id_hex, 1, 16) || '...' as token_id,
        substring(condition_id, 1, 16) || '...' as condition,
        outcome_index,
        substring(question, 1, 40) || '...' as question_short,
        first_seen_block,
        mapping_source,
        mapping_confidence
      FROM pm_erc1155_token_map_hex
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Mappings:');
  console.table(samples);
  console.log('');

  // Step 5: Coverage against erc1155_transfers
  console.log('Step 5: Calculating coverage vs erc1155_transfers...');
  console.log('');

  const coverageQuery = await clickhouse.query({
    query: `
      WITH
        all_tokens AS (
          SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) as token_norm
          FROM erc1155_transfers
          WHERE token_id != ''
            AND token_id != '0x0'
            AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ),
        mapped_tokens AS (
          SELECT DISTINCT erc1155_token_id_hex
          FROM pm_erc1155_token_map_hex
        )
      SELECT
        (SELECT COUNT(*) FROM all_tokens) as total_erc1155_tokens,
        (SELECT COUNT(*) FROM mapped_tokens) as mapped_tokens,
        (SELECT COUNT(*)
         FROM all_tokens at
         INNER JOIN mapped_tokens mt ON at.token_norm = mt.erc1155_token_id_hex
        ) as join_success,
        ROUND((SELECT COUNT(*)
               FROM all_tokens at
               INNER JOIN mapped_tokens mt ON at.token_norm = mt.erc1155_token_id_hex
              ) * 100.0 / (SELECT COUNT(*) FROM all_tokens), 2) as coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageQuery.json();
  console.log('Coverage vs erc1155_transfers:');
  console.table(coverage);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_erc1155_token_map_hex created successfully');
  console.log('');
  console.log('Purpose: AUDIT/VERIFICATION ONLY (limited coverage)');
  console.log('Source:  legacy_token_condition_map');
  console.log('Format:  Hex strings (64 chars, no 0x)');
  console.log(`Tokens:  ${parseInt(coverage[0].mapped_tokens).toLocaleString()}`);
  console.log(`Coverage: ${coverage[0].coverage_pct}% of erc1155_transfers`);
  console.log('');
  console.log('Limitations:');
  console.log('  - Only covers legacy markets (~6.5% of tokens)');
  console.log('  - 1:1 token=condition mapping (no outcome differentiation)');
  console.log('  - Not suitable for comprehensive blockchain verification');
  console.log('');
  console.log('For Primary Analytics:');
  console.log('  - Use pm_asset_token_map (100% CLOB coverage)');
  console.log('  - CLOB data is complete and authoritative for trades/PnL');
  console.log('');
  console.log('Use Cases for This Table:');
  console.log('  - Limited blockchain audits (6.5% coverage)');
  console.log('  - Legacy market verification');
  console.log('  - Supplementary cross-checking');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Creation failed:', error);
  process.exit(1);
});
