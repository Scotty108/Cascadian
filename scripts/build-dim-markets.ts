#!/usr/bin/env npx tsx

/**
 * Build dim_markets - Market Dimension Table
 *
 * Merges 4 market metadata tables into single canonical dimension:
 * - api_markets_staging (161K) - Base: question, outcomes, volume, liquidity
 * - gamma_markets (150K) - Enrichment: category, tags, descriptions
 * - market_key_map (157K) - Enrichment: market_id, resolved_at (89% overlap with API)
 * - condition_market_map (152K) - Enrichment: event_id, canonical_category (4.5% overlap)
 *
 * Strategy: API+Gamma base with MKM/CMM enrichment
 * Result: 318,535 unique markets with 92%+ market_id coverage
 * Runtime: ~1-2 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const ch = clickhouse;

  console.log('🏗️  Building dim_markets dimension table...\n');

  // Step 1: Create staging table with merged data
  console.log('Step 1: Merging market metadata from 5 sources...');

  const createStagingQuery = `
    CREATE TABLE IF NOT EXISTS default.dim_markets_staging
    ENGINE = ReplacingMergeTree()
    ORDER BY condition_id_norm
    AS
    WITH
    -- Pre-normalize all source tables to avoid JOIN computation overhead
    api_normalized AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        market_slug,
        question,
        description,
        outcomes,
        active,
        closed,
        resolved,
        winning_outcome,
        end_date,
        volume,
        liquidity,
        timestamp
      FROM default.api_markets_staging
      WHERE length(replaceAll(condition_id, '0x', '')) = 64
    ),
    gamma_normalized AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        token_id,
        question,
        description,
        outcome,
        outcomes_json,
        end_date,
        category,
        tags_json,
        closed,
        archived,
        fetched_at
      FROM default.gamma_markets
      WHERE length(replaceAll(condition_id, '0x', '')) = 64
    ),
    cmm_normalized AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        market_id,
        event_id,
        canonical_category,
        raw_tags,
        ver
      FROM default.condition_market_map
      WHERE length(replaceAll(condition_id, '0x', '')) = 64
    ),
    mkm_normalized AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        market_id,
        question,
        resolved_at
      FROM default.market_key_map
      WHERE length(replaceAll(condition_id, '0x', '')) = 64
    ),
    -- Union all unique condition IDs
    all_conditions AS (
      SELECT DISTINCT cid_norm FROM api_normalized
      UNION DISTINCT
      SELECT DISTINCT cid_norm FROM gamma_normalized
      UNION DISTINCT
      SELECT DISTINCT cid_norm FROM cmm_normalized
      UNION DISTINCT
      SELECT DISTINCT cid_norm FROM mkm_normalized
    )
    SELECT
      -- Normalized condition ID (primary key)
      all_conditions.cid_norm as condition_id_norm,

      -- Market ID (prioritize condition_market_map, then market_key_map, fallback to market_slug)
      coalesce(
        cmm.market_id,
        mkm.market_id,
        api.market_slug
      ) as market_id,

      -- Question/title (prioritize gamma_markets, then api_markets_staging, then market_key_map)
      coalesce(
        gm.question,
        api.question,
        mkm.question,
        ''
      ) as question,

      -- Category (gamma_markets or condition_market_map)
      coalesce(
        gm.category,
        cmm.canonical_category,
        ''
      ) as category,

      -- Outcomes array (api has Array(String), gamma has JSON string)
      coalesce(
        api.outcomes,
        if(gm.outcomes_json != '' AND gm.outcomes_json IS NOT NULL,
           JSONExtractArrayRaw(gm.outcomes_json),
           []),
        []
      ) as outcomes,

      -- Timestamps
      coalesce(
        api.end_date,
        parseDateTime64BestEffortOrNull(gm.end_date, 3)
      ) as end_date,

      -- Resolution timestamp (from market_key_map)
      mkm.resolved_at as resolved_at,

      -- Closed status
      coalesce(
        if(api.closed = 1, 1, 0),
        gm.closed,
        0
      ) as closed,

      -- Metadata
      coalesce(
        api.description,
        gm.description,
        ''
      ) as description,

      coalesce(api.volume, 0) as volume,
      coalesce(api.liquidity, 0) as liquidity,

      -- Event ID for enrichment
      cmm.event_id as event_id,

      -- Tags
      cmm.raw_tags as tags,

      -- Data source tracking (now properly detects which table provided data)
      multiIf(
        api.cid_norm IS NOT NULL AND gm.cid_norm IS NULL AND cmm.cid_norm IS NULL AND mkm.cid_norm IS NULL, 'api_only',
        gm.cid_norm IS NOT NULL AND api.cid_norm IS NULL AND cmm.cid_norm IS NULL AND mkm.cid_norm IS NULL, 'gamma_only',
        cmm.cid_norm IS NOT NULL AND api.cid_norm IS NULL AND gm.cid_norm IS NULL AND mkm.cid_norm IS NULL, 'cmm_only',
        mkm.cid_norm IS NOT NULL AND api.cid_norm IS NULL AND gm.cid_norm IS NULL AND cmm.cid_norm IS NULL, 'mkm_only',
        api.cid_norm IS NOT NULL AND gm.cid_norm IS NOT NULL, 'api+gamma',
        api.cid_norm IS NOT NULL AND cmm.cid_norm IS NOT NULL, 'api+cmm',
        gm.cid_norm IS NOT NULL AND cmm.cid_norm IS NOT NULL, 'gamma+cmm',
        'multiple_sources'
      ) as primary_source,

      now() as updated_at

    FROM all_conditions

    -- Left join pre-normalized sources
    LEFT JOIN api_normalized api ON api.cid_norm = all_conditions.cid_norm
    LEFT JOIN gamma_normalized gm ON gm.cid_norm = all_conditions.cid_norm
    LEFT JOIN cmm_normalized cmm ON cmm.cid_norm = all_conditions.cid_norm
    LEFT JOIN mkm_normalized mkm ON mkm.cid_norm = all_conditions.cid_norm
  `;

  await ch.command({ query: createStagingQuery });
  console.log('✅ Staging table created\n');

  // Step 2: Validate row count
  console.log('Step 2: Validating merged data...');

  const countResult = await ch.query({
    query: 'SELECT count() as count FROM default.dim_markets_staging',
    format: 'JSONEachRow'
  });

  const rows = await countResult.json<Array<{ count: string }>>();
  const rowCount = parseInt(rows[0].count);

  console.log(`  Total markets: ${rowCount.toLocaleString()}`);

  if (rowCount < 200000) {
    throw new Error(`Expected ~233K markets, got ${rowCount}. Check source data.`);
  }

  // Step 3: Check data quality
  console.log('\nStep 3: Checking data quality...');

  const qualityResult = await ch.query({
    query: `
      SELECT
        count() as total,
        countIf(market_id != '') as with_market_id,
        countIf(question != '') as with_question,
        countIf(category != '') as with_category,
        countIf(length(outcomes) > 0) as with_outcomes,
        countIf(description != '') as with_description,
        countIf(event_id != '') as with_event_id,
        countIf(length(tags) > 0) as with_tags,
        countIf(primary_source LIKE '%api%') as has_api_data,
        countIf(primary_source LIKE '%gamma%') as has_gamma_data,
        countIf(primary_source LIKE '%cmm%') as has_cmm_data,
        countIf(primary_source LIKE '%mkm%') as has_mkm_data,
        countIf(primary_source = 'api_only') as api_only,
        countIf(primary_source = 'gamma_only') as gamma_only,
        countIf(primary_source = 'cmm_only') as cmm_only,
        countIf(primary_source = 'mkm_only') as mkm_only,
        countIf(primary_source = 'multiple_sources') as multiple_sources
      FROM default.dim_markets_staging
    `,
    format: 'JSONEachRow'
  });

  const quality = await qualityResult.json<Array<any>>();
  const q = quality[0];

  console.log(`  With market_id: ${parseInt(q.with_market_id).toLocaleString()} (${(parseInt(q.with_market_id)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With question: ${parseInt(q.with_question).toLocaleString()} (${(parseInt(q.with_question)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With category: ${parseInt(q.with_category).toLocaleString()} (${(parseInt(q.with_category)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With outcomes: ${parseInt(q.with_outcomes).toLocaleString()} (${(parseInt(q.with_outcomes)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With description: ${parseInt(q.with_description).toLocaleString()} (${(parseInt(q.with_description)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With event_id: ${parseInt(q.with_event_id).toLocaleString()} (${(parseInt(q.with_event_id)/rowCount*100).toFixed(1)}%)`);
  console.log(`  With tags: ${parseInt(q.with_tags).toLocaleString()} (${(parseInt(q.with_tags)/rowCount*100).toFixed(1)}%)`);
  console.log('\n  Data source coverage:');
  console.log(`    Has API data: ${parseInt(q.has_api_data).toLocaleString()} (${(parseInt(q.has_api_data)/rowCount*100).toFixed(1)}%)`);
  console.log(`    Has Gamma data: ${parseInt(q.has_gamma_data).toLocaleString()} (${(parseInt(q.has_gamma_data)/rowCount*100).toFixed(1)}%)`);
  console.log(`    Has CMM data: ${parseInt(q.has_cmm_data).toLocaleString()} (${(parseInt(q.has_cmm_data)/rowCount*100).toFixed(1)}%)`);
  console.log(`    Has MKM data: ${parseInt(q.has_mkm_data).toLocaleString()} (${(parseInt(q.has_mkm_data)/rowCount*100).toFixed(1)}%)`);
  console.log('\n  Source combinations:');
  console.log(`    API only: ${parseInt(q.api_only).toLocaleString()}`);
  console.log(`    Gamma only: ${parseInt(q.gamma_only).toLocaleString()}`);
  console.log(`    CMM only: ${parseInt(q.cmm_only).toLocaleString()}`);
  console.log(`    MKM only: ${parseInt(q.mkm_only).toLocaleString()}`);
  console.log(`    Multiple sources: ${parseInt(q.multiple_sources).toLocaleString()}`);

  // Step 4: Atomic swap (create final table, rename)
  console.log('\nStep 4: Performing atomic swap...');

  // Drop old table if exists
  await ch.command({ query: 'DROP TABLE IF EXISTS default.dim_markets_old' });

  // Rename current dim_markets to old (if exists)
  try {
    await ch.command({
      query: 'RENAME TABLE default.dim_markets TO default.dim_markets_old'
    });
    console.log('  Backed up existing dim_markets');
  } catch (e) {
    console.log('  No existing dim_markets to backup');
  }

  // Rename staging to final
  await ch.command({
    query: 'RENAME TABLE default.dim_markets_staging TO default.dim_markets'
  });
  console.log('  Promoted staging to dim_markets');

  // Step 5: Sample check
  console.log('\nStep 5: Sample validation...');

  const sampleResult = await ch.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) as condition_preview,
        market_id,
        substring(question, 1, 60) as question_preview,
        category,
        length(outcomes) as outcome_count,
        closed,
        volume,
        length(tags) as tag_count,
        primary_source
      FROM default.dim_markets
      WHERE market_id != ''
      ORDER BY rand()
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json<Array<any>>();

  console.log('\n  Sample markets:');
  samples.forEach((s, i) => {
    console.log(`\n  ${i + 1}. ${s.question_preview}...`);
    console.log(`     Condition: ${s.condition_preview}...`);
    console.log(`     Market ID: ${s.market_id.substring(0, 20)}...`);
    console.log(`     Category: ${s.category || 'N/A'}`);
    console.log(`     Outcomes: ${s.outcome_count}`);
    console.log(`     Volume: $${parseFloat(s.volume).toLocaleString()}`);
    console.log(`     Tags: ${s.tag_count}`);
    console.log(`     Closed: ${s.closed ? 'Yes' : 'No'}`);
    console.log(`     Source: ${s.primary_source}`);
  });

  console.log('\n✅ dim_markets built successfully!');
  console.log(`   Total markets: ${rowCount.toLocaleString()}`);
  console.log(`   Table: default.dim_markets`);
  console.log(`   Old backup: default.dim_markets_old (can be dropped)\n`);
}

main().catch(console.error);
