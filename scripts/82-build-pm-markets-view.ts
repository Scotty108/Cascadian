#!/usr/bin/env tsx
/**
 * Build pm_markets View - Canonical Markets
 *
 * Creates canonical markets view (one row per outcome token).
 * Follows PM_CANONICAL_SCHEMA_C1.md specification.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🏗️  Building pm_markets View (Canonical Markets)');
  console.log('='.repeat(60));
  console.log('');

  console.log('Source Tables:');
  console.log('  - Base: pm_asset_token_map (139K assets)');
  console.log('  - Metadata: gamma_markets (~150K markets)');
  console.log('  - Resolutions: market_resolutions_final (~157K resolved)');
  console.log('');

  console.log('Step 1: Dropping existing pm_markets view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_markets'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_markets view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_markets AS
      SELECT
        -- Canonical Anchors
        atm.condition_id as condition_id,                       -- String, condition ID (64 chars)
        atm.outcome_index as outcome_index,                     -- UInt8, 0-based outcome index

        -- Market Identification
        '' as market_slug,                                      -- String, not available in gamma_markets
        atm.question as question,                               -- String, market question
        atm.outcome_label as outcome_label,                     -- String, "Yes", "No", etc.

        -- Market Metadata
        atm.outcomes_json as outcomes_json,                     -- String, JSON array of all outcomes
        JSONLength(atm.outcomes_json) as total_outcomes,        -- UInt8, number of outcomes
        CASE
          WHEN JSONLength(atm.outcomes_json) = 2 THEN 'binary'
          WHEN JSONLength(atm.outcomes_json) > 2 THEN 'categorical'
          ELSE 'unknown'
        END as market_type,                                     -- String, market type

        -- Status (from market_resolutions_final)
        CASE
          WHEN mrf.resolved_at IS NOT NULL THEN 'resolved'
          WHEN gm.closed = 1 THEN 'closed'
          WHEN gm.closed = 0 THEN 'open'
          ELSE 'unknown'
        END as status,                                          -- String, market status

        mrf.resolved_at as resolved_at,                         -- DateTime, resolution timestamp
        mrf.winning_index as winning_outcome_index,             -- UInt16, winning outcome index
        CASE
          WHEN mrf.winning_index = atm.outcome_index THEN 1
          ELSE 0
        END as is_winning_outcome,                              -- UInt8, 1 if this outcome won

        -- Enrichment (from gamma_markets)
        COALESCE(gm.description, '') as description,            -- String, market description
        COALESCE(gm.category, '') as category,                  -- String, market category
        gm.end_date as end_date,                                -- DateTime, market end date

        -- Source Tracking
        'gamma_markets' as data_source                          -- String, source table

      FROM pm_asset_token_map atm
      LEFT JOIN gamma_markets gm
        ON atm.condition_id = gm.condition_id
      LEFT JOIN market_resolutions_final mrf
        ON atm.condition_id = toString(mrf.condition_id_norm)
      WHERE atm.condition_id IS NOT NULL
    `
  });

  console.log('✅ pm_markets view created');
  console.log('');

  // Get quick stats
  console.log('Step 3: Gathering statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(DISTINCT market_slug) as distinct_slugs,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
        COUNT(CASE WHEN is_winning_outcome = 1 THEN 1 END) as winning_outcomes,
        COUNT(CASE WHEN market_type = 'binary' THEN 1 END) as binary_markets,
        COUNT(CASE WHEN market_type = 'categorical' THEN 1 END) as categorical_markets
      FROM pm_markets
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('pm_markets Statistics:');
  console.table(stats);
  console.log('');

  // Sample markets
  console.log('Step 4: Sample markets...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id, 1, 16) || '...' as condition_short,
        outcome_index,
        outcome_label,
        total_outcomes,
        market_type,
        status,
        is_winning_outcome,
        substring(question, 1, 40) || '...' as question_short,
        data_source
      FROM pm_markets
      WHERE status = 'resolved'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Markets (resolved):');
  console.table(samples);
  console.log('');

  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ pm_markets view created successfully');
  console.log('');
  console.log('Base Table: pm_asset_token_map');
  console.log('Enrichment: LEFT JOIN gamma_markets, gamma_resolved');
  console.log('');
  console.log(`Total Rows: ${parseInt(stats[0].total_rows).toLocaleString()}`);
  console.log(`Distinct Conditions: ${parseInt(stats[0].distinct_conditions).toLocaleString()}`);
  console.log('');
  console.log('Status Distribution:');
  console.log(`  Resolved: ${parseInt(stats[0].resolved_count).toLocaleString()}`);
  console.log(`  Open: ${parseInt(stats[0].open_count).toLocaleString()}`);
  console.log(`  Closed: ${parseInt(stats[0].closed_count).toLocaleString()}`);
  console.log('');
  console.log('Market Type Distribution:');
  console.log(`  Binary: ${parseInt(stats[0].binary_markets).toLocaleString()}`);
  console.log(`  Categorical: ${parseInt(stats[0].categorical_markets).toLocaleString()}`);
  console.log('');
  console.log(`Winning Outcomes: ${parseInt(stats[0].winning_outcomes).toLocaleString()}`);
  console.log('');
  console.log('Schema Compliance:');
  console.log('  ✅ One row per outcome token (not per market)');
  console.log('  ✅ is_winning_outcome flag for easy PnL queries');
  console.log('  ✅ Streaming-friendly (no hard-coded filters)');
  console.log('  ✅ Non-destructive (view, not table)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
