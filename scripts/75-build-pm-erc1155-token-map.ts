#!/usr/bin/env tsx
/**
 * Build pm_erc1155_token_map v1
 *
 * Strategy: Map observed ERC-1155 token_ids to condition_id + outcome using existing bridge tables
 *
 * Sources (priority order):
 * 1. erc1155_condition_map - direct mapping if available
 * 2. ctf_to_market_bridge_mat - condition → market bridge
 * 3. api_ctf_bridge - condition → API market_id
 * 4. condition_market_map - condition metadata
 * 5. ctf_token_map - outcome labels via condition_id
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_erc1155_token_map v1');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Analyze erc1155_condition_map as potential direct source
  console.log('Step 1: Analyzing erc1155_condition_map for usable mappings...');

  const validMappingsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT token_id) as distinct_tokens,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        SUM(CASE
          WHEN condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND condition_id != ''
            AND token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND token_id != ''
          THEN 1 ELSE 0
        END) as non_zero_rows
      FROM erc1155_condition_map
    `,
    format: 'JSONEachRow'
  });

  const stats = await validMappingsQuery.json();
  console.log('erc1155_condition_map statistics:');
  console.table(stats);

  // Check if we can use it
  const nonZeroCount = parseInt(stats[0].non_zero_rows);
  const useERC1155Map = nonZeroCount > 1000;  // Threshold for usability

  if (useERC1155Map) {
    console.log(`✅ erc1155_condition_map has ${nonZeroCount} valid mappings - WILL USE`);
  } else {
    console.log(`⚠️  erc1155_condition_map only has ${nonZeroCount} valid mappings - SKIP`);
  }
  console.log('');

  // Step 2: Get distinct ERC-1155 token_ids from transfers
  console.log('Step 2: Getting distinct token_ids from erc1155_transfers...');

  const distinctTokensQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT lower(replaceAll(token_id, '0x', ''))) as distinct_tokens
      FROM erc1155_transfers
      WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND token_id != ''
    `,
    format: 'JSONEachRow'
  });

  const tokenStats = await distinctTokensQuery.json();
  console.log(`Found ${tokenStats[0].distinct_tokens} distinct ERC-1155 token_ids`);
  console.log('');

  // Step 3: Create the table schema
  console.log('Step 3: Creating pm_erc1155_token_map table...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_erc1155_token_map (
        -- Token Identification
        erc1155_token_id_hex    String,        -- Normalized: no 0x, lowercase, 64 chars

        -- Canonical Anchors
        condition_id            String,        -- Normalized: no 0x, lowercase, 64 chars
        outcome_index           UInt8,         -- 0-based index (inferred if possible)
        outcome_label           String,        -- "Yes", "No", outcome name (if known)

        -- Metadata
        question                String,        -- Market question (if known)
        market_slug             String,        -- API market ID (if known)

        -- Event Metadata (for deduplication and debugging)
        first_seen_block        UInt64,        -- First block where this token appeared
        first_seen_timestamp    DateTime,      -- Timestamp of first appearance
        first_seen_tx           String,        -- Transaction hash of first appearance

        -- Source Tracking
        mapping_source          String,        -- Which bridge table provided the mapping
        mapping_confidence      UInt8,         -- 0-100, higher = more reliable

        -- Housekeeping
        created_at              DateTime DEFAULT now(),
        updated_at              DateTime DEFAULT now()

      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (erc1155_token_id_hex, condition_id);
    `
  });

  console.log('✅ Table created/verified');
  console.log('');

  // Step 4: Build mapping from available sources
  console.log('Step 4: Building token → condition mappings...');
  console.log('');

  // Source 1: erc1155_condition_map (if viable)
  if (useERC1155Map) {
    console.log('  Source 1: erc1155_condition_map (basic mapping)...');

    // Simple approach: just get the basic token → condition mapping first
    await clickhouse.command({
      query: `
        INSERT INTO pm_erc1155_token_map
        SELECT
          lower(replaceAll(ecm.token_id, '0x', '')) as erc1155_token_id_hex,
          lower(replaceAll(ecm.condition_id, '0x', '')) as condition_id,

          0 as outcome_index,  -- Will enrich later
          '' as outcome_label,
          '' as question,
          '' as market_slug,

          -- Event metadata from erc1155_transfers
          min(et.block_number) as first_seen_block,
          min(et.block_timestamp) as first_seen_timestamp,
          argMin(et.tx_hash, et.block_number) as first_seen_tx,

          'erc1155_condition_map' as mapping_source,
          80 as mapping_confidence,

          now() as created_at,
          now() as updated_at

        FROM erc1155_condition_map ecm
        LEFT JOIN erc1155_transfers et
          ON lower(replaceAll(et.token_id, '0x', '')) = lower(replaceAll(ecm.token_id, '0x', ''))
        WHERE ecm.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND ecm.condition_id != ''
          AND ecm.token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND ecm.token_id != ''
        GROUP BY
          ecm.token_id,
          ecm.condition_id;
      `
    });

    const countQuery = await clickhouse.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_token_map WHERE mapping_source = 'erc1155_condition_map'`,
      format: 'JSONEachRow'
    });
    const count = await countQuery.json();
    console.log(`    ✅ Added ${count[0].cnt} basic mappings`);
    console.log(`    ℹ️  Metadata enrichment (outcome_label, question, market_slug) to be added in v2`);
  }

  // Step 5: Report initial results
  console.log('');
  console.log('='.repeat(60));
  console.log('📊 INITIAL BUILD RESULTS');
  console.log('='.repeat(60));
  console.log('');

  const finalStats = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_mappings,
        COUNT(DISTINCT erc1155_token_id_hex) as distinct_tokens,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(CASE WHEN outcome_label != '' THEN 1 END) as with_outcome_label,
        COUNT(CASE WHEN question != '' THEN 1 END) as with_question,
        COUNT(CASE WHEN market_slug != '' THEN 1 END) as with_market_slug
      FROM pm_erc1155_token_map
    `,
    format: 'JSONEachRow'
  });

  const final = await finalStats.json();
  console.log('pm_erc1155_token_map statistics:');
  console.table(final);

  console.log('');
  console.log('✅ pm_erc1155_token_map v1 build complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run 76-erc1155-bridge-coverage.ts for full coverage analysis');
  console.log('  2. Investigate unmapped token_ids');
  console.log('  3. Add additional bridge sources if needed');
}

main().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
