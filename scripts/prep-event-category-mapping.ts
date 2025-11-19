#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * EVENT & CATEGORY MAPPING PREPARATION
 *
 * This script prepares the infrastructure for mapping all markets to events with categories and tags.
 *
 * Strategy:
 * 1. Create enriched condition_market_map with event_id + category + tags
 * 2. Use market title fuzzy matching to link to events_dim
 * 3. Fall back to creating synthetic events for unmapped markets
 * 4. Create views for easy PnL by category queries
 */

async function analyzeCurrentState() {
  console.log('ANALYZING CURRENT MAPPING STATE\n');
  console.log('═'.repeat(80));

  // Check how many trades have event mappings
  const coverageQuery = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total_conditions,
        (SELECT count(DISTINCT condition_id)
         FROM default.condition_market_map
         WHERE event_id != '' AND canonical_category != '') AS mapped_with_events,
        (SELECT count(DISTINCT condition_id)
         FROM default.condition_market_map) AS total_in_map
    `,
    format: 'JSONEachRow',
  });
  const coverage = (await coverageQuery.json<any[]>())[0];

  console.log(`Trades coverage:`);
  console.log(`  Total condition_ids in trades: ${coverage.total_conditions.toLocaleString()}`);
  console.log(`  Mapped with events: ${coverage.mapped_with_events.toLocaleString()}`);
  console.log(`  Total in condition_market_map: ${coverage.total_in_map.toLocaleString()}`);
  console.log(`  Coverage gap: ${(coverage.total_conditions - coverage.mapped_with_events).toLocaleString()}\n`);

  // Check events_dim categories
  const categoriesQuery = await client.query({
    query: `
      SELECT DISTINCT canonical_category, count() as cnt
      FROM default.events_dim
      WHERE canonical_category != ''
      GROUP BY canonical_category
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow',
  });
  const categories = await categoriesQuery.json<any[]>();

  console.log(`Available categories in events_dim:`);
  for (const cat of categories.slice(0, 15)) {
    console.log(`  ${cat.canonical_category}: ${cat.cnt.toLocaleString()} events`);
  }
  console.log(`  ... (${categories.length} total categories)\n`);
}

async function createEnrichedMappingTable() {
  console.log('CREATING ENRICHED MAPPING TABLE\n');
  console.log('═'.repeat(80));

  // Create new enriched table
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.market_event_mapping (
        condition_id String,
        market_id String,
        event_id String,
        canonical_category String,
        raw_tags Array(String),
        market_title String,
        mapping_source Enum8('exact_match'=1, 'fuzzy_match'=2, 'synthetic'=3),
        confidence Float32,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(created_at)
      ORDER BY condition_id
    `,
  });

  console.log('✅ Created market_event_mapping table\n');
}

async function createMappingStrategies() {
  console.log('MAPPING STRATEGIES\n');
  console.log('═'.repeat(80));

  console.log(`
Strategy 1: Exact Title Match
  - Match market titles from resolutions_src_api to events_dim.title
  - High confidence (0.95+)

Strategy 2: Fuzzy Title Match
  - Use levenshteinDistance or ngramDistance for similarity
  - Medium confidence (0.70-0.95)

Strategy 3: Synthetic Events
  - Create new events for unmapped markets
  - Category: "Uncategorized" or derived from market metadata
  - Low confidence (0.50)

Strategy 4: Manual Override
  - Allow manual category assignment for important markets
  - Highest confidence (1.0)
`);
}

async function createMappingView() {
  console.log('CREATING MAPPING VIEW FOR PNL QUERIES\n');
  console.log('═'.repeat(80));

  // Create view that combines all mapping sources
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW default.vw_condition_categories AS

      -- Priority 1: Manual overrides (if we add them later)
      SELECT
        condition_id,
        canonical_category,
        raw_tags,
        event_id,
        'manual' AS source
      FROM default.market_event_mapping
      WHERE mapping_source = 'exact_match'

      UNION ALL

      -- Priority 2: Existing events_dim data via condition_market_map
      SELECT
        cm.condition_id,
        e.canonical_category,
        e.raw_tags,
        e.event_id,
        'events_dim' AS source
      FROM default.condition_market_map cm
      INNER JOIN default.events_dim e
        ON cm.event_id = e.event_id
      WHERE e.canonical_category != ''

      UNION ALL

      -- Priority 3: Backfilled data (when available)
      SELECT
        lower(concat('0x', cid_hex)) AS condition_id,
        category AS canonical_category,
        tags AS raw_tags,
        '' AS event_id,
        'backfill_api' AS source
      FROM cascadian_clean.resolutions_src_api
      WHERE category != ''

      UNION ALL

      -- Priority 4: Default category for unmapped
      SELECT
        condition_id_norm AS condition_id,
        'Uncategorized' AS canonical_category,
        CAST([] AS Array(String)) AS raw_tags,
        '' AS event_id,
        'default' AS source
      FROM default.vw_trades_canonical
      WHERE condition_id_norm NOT IN (
        SELECT condition_id FROM default.condition_market_map WHERE event_id != ''
      )
    `,
  });

  console.log('✅ Created vw_condition_categories view\n');
}

async function createPnLByCategoryView() {
  console.log('CREATING PNL BY CATEGORY VIEW\n');
  console.log('═'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW default.vw_pnl_by_category AS

      SELECT
        t.wallet_address_norm,
        c.canonical_category,
        c.source AS category_source,
        count(DISTINCT t.condition_id_norm) AS markets_traded,
        sum(t.usd_value) AS total_volume,
        sum(
          CASE
            WHEN r.resolved = 1 AND r.winning_index >= 0 THEN
              (t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value
            ELSE 0
          END
        ) AS realized_pnl
      FROM default.vw_trades_canonical t
      LEFT JOIN default.vw_condition_categories c
        ON lower(t.condition_id_norm) = lower(c.condition_id)
      LEFT JOIN cascadian_clean.vw_resolutions_unified r
        ON lower(t.condition_id_norm) = r.cid_hex
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY t.wallet_address_norm, c.canonical_category, c.source
    `,
  });

  console.log('✅ Created vw_pnl_by_category view\n');
}

async function showNextSteps() {
  console.log('\nNEXT STEPS\n');
  console.log('═'.repeat(80));

  console.log(`
1. AFTER BACKFILL COMPLETES (~2 hours):
   - Run enrichment script to populate market_event_mapping
   - Match market titles to events_dim
   - Create synthetic events for unmapped markets

2. IMMEDIATE USE:
   - vw_condition_categories provides category for every condition_id
   - vw_pnl_by_category gives P&L breakdown by category

3. QUERY EXAMPLES:

   -- P&L by category for a wallet
   SELECT
     canonical_category,
     realized_pnl,
     markets_traded
   FROM default.vw_pnl_by_category
   WHERE wallet_address = '0x...'
   ORDER BY realized_pnl DESC

   -- Top categories by volume
   SELECT
     canonical_category,
     sum(total_volume) AS total_vol,
     sum(realized_pnl) AS total_pnl
   FROM default.vw_pnl_by_category
   GROUP BY canonical_category
   ORDER BY total_vol DESC
   LIMIT 20

4. ENRICHMENT SCRIPT (to run after backfill):
   npx tsx enrich-market-event-mapping.ts
`);
}

async function main() {
  try {
    await analyzeCurrentState();
    await createEnrichedMappingTable();
    await createMappingStrategies();
    await createMappingView();
    await createPnLByCategoryView();
    await showNextSteps();

    console.log('\n✅ PREPARATION COMPLETE\n');
    console.log('Infrastructure is ready for event/category mapping.');
    console.log('Run this script again after backfill completes to populate mappings.\n');

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

main().catch(console.error);
