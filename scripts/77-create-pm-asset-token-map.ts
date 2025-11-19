#!/usr/bin/env tsx
/**
 * Create pm_asset_token_map - CLOB/Gamma Asset Mapping View
 *
 * This is the PRIMARY mapping table for canonical trades and PnL.
 * Backed by ctf_token_map with ~100% coverage of Gamma markets.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Creating pm_asset_token_map (CLOB Asset Mapping)');
  console.log('='.repeat(60));
  console.log('');

  console.log('Step 1: Creating materialized view from ctf_token_map...');
  console.log('');

  // Create materialized view backed by ctf_token_map
  await clickhouse.command({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS pm_asset_token_map
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (asset_id_decimal, condition_id)
      AS
      SELECT
        -- Asset Identification (CLOB/Gamma world)
        token_id as asset_id_decimal,                    -- Decimal string (76-78 chars)

        -- Canonical Anchors
        condition_id_norm as condition_id,               -- Normalized: no 0x, lowercase, 64 chars
        CAST(outcome AS UInt8) as outcome_index,         -- 0-based outcome index
        outcome as outcome_label,                        -- "Yes", "No", or outcome name

        -- Metadata
        question,                                        -- Market question
        outcomes_json,                                   -- JSON array of all outcomes

        -- Market Linkage
        '' as market_slug,                               -- Will enrich from api_ctf_bridge if needed

        -- Source Tracking
        'ctf_token_map' as mapping_source,
        100 as mapping_confidence,                       -- Maximum confidence for canonical source

        -- Housekeeping
        now() as created_at,
        now() as updated_at

      FROM ctf_token_map
      WHERE condition_id_norm != ''
        AND token_id != ''
    `
  });

  console.log('✅ Materialized view created');
  console.log('');

  // Get statistics
  console.log('Step 2: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_mappings,
        COUNT(DISTINCT asset_id_decimal) as distinct_assets,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(DISTINCT outcome_index) as distinct_outcomes,
        MIN(length(asset_id_decimal)) as min_asset_len,
        MAX(length(asset_id_decimal)) as max_asset_len,
        AVG(length(asset_id_decimal)) as avg_asset_len
      FROM pm_asset_token_map
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_asset_token_map Statistics:');
  console.table(stats);
  console.log('');

  // Sample rows
  console.log('Step 3: Sample mappings...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(asset_id_decimal, 1, 20) || '...' as asset_id,
        substring(condition_id, 1, 16) || '...' as condition,
        outcome_index,
        outcome_label,
        substring(question, 1, 40) || '...' as question_short,
        mapping_source,
        mapping_confidence
      FROM pm_asset_token_map
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Mappings:');
  console.table(samples);
  console.log('');

  // Validate coverage
  console.log('Step 4: Validating coverage vs ctf_token_map...');
  console.log('');

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(DISTINCT token_id) FROM ctf_token_map WHERE token_id != '') as ctf_total,
        (SELECT COUNT(DISTINCT asset_id_decimal) FROM pm_asset_token_map) as map_total,
        ROUND((SELECT COUNT(DISTINCT asset_id_decimal) FROM pm_asset_token_map) * 100.0 /
              (SELECT COUNT(DISTINCT token_id) FROM ctf_token_map WHERE token_id != ''), 2) as coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageQuery.json();
  console.log('Coverage vs ctf_token_map:');
  console.table(coverage);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_asset_token_map created successfully');
  console.log('');
  console.log('Purpose: PRIMARY mapping for CLOB/Gamma assets → conditions');
  console.log('Source:  ctf_token_map (canonical Gamma data)');
  console.log('Format:  Decimal strings (76-78 chars)');
  console.log(`Coverage: ${coverage[0].coverage_pct}% of ctf_token_map assets`);
  console.log('');
  console.log('Usage:');
  console.log('  - Canonical trades (pm_trades)');
  console.log('  - PnL calculations');
  console.log('  - Market analytics');
  console.log('  - Smart money tracking');
  console.log('');
  console.log('⚠️  Note: This is for CLOB/decimal assets, NOT hex ERC-1155 tokens');
  console.log('   For hex tokens, use pm_erc1155_token_map_hex (separate table)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Creation failed:', error);
  process.exit(1);
});
