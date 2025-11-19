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
 * DIMENSION TABLE ANALYSIS
 *
 * Analyzes current dimension tables and identifies enrichment opportunities
 */

async function analyzeDimensions() {
  console.log('DIMENSION TABLE ANALYSIS\n');
  console.log('═'.repeat(80));
  console.log('Analyzing dimension tables to identify enrichment opportunities...\n');

  // Check events_dim
  console.log('1. EVENTS_DIM');
  console.log('─'.repeat(80));

  const eventsDim = await client.query({
    query: `
      SELECT
        count() as total_events,
        count(DISTINCT event_id) as unique_events,
        count(DISTINCT canonical_category) as unique_categories,
        countIf(canonical_category != '') as events_with_category,
        countIf(length(raw_tags) > 0) as events_with_tags
      FROM default.events_dim
    `,
    format: 'JSONEachRow',
  });

  const eventsData = (await eventsDim.json<any[]>())[0];
  console.log(`  Total events: ${eventsData.total_events.toLocaleString()}`);
  console.log(`  Unique events: ${eventsData.unique_events.toLocaleString()}`);
  console.log(`  Categories: ${eventsData.unique_categories}`);
  console.log(`  With category: ${eventsData.events_with_category.toLocaleString()}`);
  console.log(`  With tags: ${eventsData.events_with_tags.toLocaleString()}`);

  // Check if events_dim has condition_ids
  const eventsSchema = await client.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default' AND table = 'events_dim'
      ORDER BY position
    `,
    format: 'JSONEachRow',
  });

  const eventsColumns = await eventsSchema.json<any[]>();
  console.log(`\n  Current schema (${eventsColumns.length} columns):`);
  for (const col of eventsColumns) {
    console.log(`    ${col.name.padEnd(30)} ${col.type}`);
  }

  const hasConditionIds = eventsColumns.some(c => c.name.includes('condition'));
  console.log(`\n  ❓ Has condition_ids? ${hasConditionIds ? 'YES' : 'NO - NEEDS ENRICHMENT'}`);

  // Check markets_dim
  console.log('\n\n2. MARKETS_DIM');
  console.log('─'.repeat(80));

  const marketsDim = await client.query({
    query: `
      SELECT
        count() as total_markets,
        count(DISTINCT market_id) as unique_markets,
        countIf(category != '') as markets_with_category
      FROM default.markets_dim
    `,
    format: 'JSONEachRow',
  });

  const marketsData = (await marketsDim.json<any[]>())[0];
  console.log(`  Total markets: ${marketsData.total_markets.toLocaleString()}`);
  console.log(`  Unique markets: ${marketsData.unique_markets.toLocaleString()}`);
  console.log(`  With category: ${marketsData.markets_with_category.toLocaleString()}`);

  const marketsSchema = await client.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default' AND table = 'markets_dim'
      ORDER BY position
    `,
    format: 'JSONEachRow',
  });

  const marketsColumns = await marketsSchema.json<any[]>();
  console.log(`\n  Current schema (${marketsColumns.length} columns):`);
  for (const col of marketsColumns) {
    console.log(`    ${col.name.padEnd(30)} ${col.type}`);
  }

  const hasEventId = marketsColumns.some(c => c.name.includes('event'));
  const hasCondition = marketsColumns.some(c => c.name.includes('condition'));
  console.log(`\n  ❓ Has event_id? ${hasEventId ? 'YES' : 'NO - NEEDS ENRICHMENT'}`);
  console.log(`  ❓ Has condition_id? ${hasCondition ? 'YES' : 'NO - NEEDS ENRICHMENT'}`);

  // Check condition_market_map
  console.log('\n\n3. CONDITION_MARKET_MAP (Junction Table)');
  console.log('─'.repeat(80));

  const mapData = await client.query({
    query: `
      SELECT
        count() as total_mappings,
        count(DISTINCT condition_id) as unique_conditions,
        count(DISTINCT market_id) as unique_markets,
        countIf(event_id != '') as mappings_with_event
      FROM default.condition_market_map
    `,
    format: 'JSONEachRow',
  });

  const mapStats = (await mapData.json<any[]>())[0];
  console.log(`  Total mappings: ${mapStats.total_mappings.toLocaleString()}`);
  console.log(`  Unique conditions: ${mapStats.unique_conditions.toLocaleString()}`);
  console.log(`  Unique markets: ${mapStats.unique_markets.toLocaleString()}`);
  console.log(`  With event_id: ${mapStats.mappings_with_event.toLocaleString()}`);

  // Check coverage: how many trades have enriched metadata?
  console.log('\n\n4. TRADE COVERAGE WITH ENRICHED METADATA');
  console.log('─'.repeat(80));

  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as total_conditions_traded,

        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN default.condition_market_map cm
           ON lower(t.condition_id_norm) = lower(cm.condition_id)
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as conditions_in_map,

        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN default.condition_market_map cm
           ON lower(t.condition_id_norm) = lower(cm.condition_id)
         INNER JOIN default.events_dim e
           ON cm.event_id = e.event_id
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
           AND e.canonical_category != '') as conditions_with_category
    `,
    format: 'JSONEachRow',
  });

  const coverageStats = (await coverage.json<any[]>())[0];
  const mapCoveragePct = (100 * coverageStats.conditions_in_map / coverageStats.total_conditions_traded).toFixed(1);
  const categoryCoveragePct = (100 * coverageStats.conditions_with_category / coverageStats.total_conditions_traded).toFixed(1);

  console.log(`  Conditions traded: ${coverageStats.total_conditions_traded.toLocaleString()}`);
  console.log(`  In condition_market_map: ${coverageStats.conditions_in_map.toLocaleString()} (${mapCoveragePct}%)`);
  console.log(`  With category metadata: ${coverageStats.conditions_with_category.toLocaleString()} (${categoryCoveragePct}%)`);

  console.log('\n\n5. ENRICHMENT OPPORTUNITIES');
  console.log('═'.repeat(80));
  console.log(`
✅ KEEP AS-IS:
  - condition_market_map (junction table) - already well-designed
  - wallets_dim - wallet metadata doesn't need event enrichment

🔧 ENRICH WITH VIEWS:
  1. events_dim → Add condition_ids array + market_ids array
     Benefits:
     - Easy to find all conditions/markets for an event
     - Fast category-based queries
     - Array contains for fast lookups

  2. markets_dim → Add event_id + canonical_category + tags
     Benefits:
     - Direct market → event → category linkage
     - No joins needed for market category queries
     - Cleaner API responses

  3. NEW: vw_conditions_enriched
     Benefits:
     - condition_id → event_id → category → tags in one view
     - Perfect for P&L by category queries
     - Minimal joins

📊 BACKFILL INTEGRATION:
  - After backfill completes, merge resolutions_src_api categories into views
  - Update vw_condition_categories to use backfilled data
  - Create materialized views for hot paths

💡 ANALYTICS QUERIES BECOME MUCH SIMPLER:

  BEFORE (multiple joins):
    SELECT category, sum(pnl)
    FROM trades t
    JOIN condition_market_map cm ON t.condition_id = cm.condition_id
    JOIN events_dim e ON cm.event_id = e.event_id
    GROUP BY category

  AFTER (single join):
    SELECT category, sum(pnl)
    FROM trades t
    JOIN vw_conditions_enriched c ON t.condition_id = c.condition_id
    GROUP BY category
`);

  console.log('\n\nNEXT STEPS:');
  console.log('═'.repeat(80));
  console.log(`
1. Create enriched dimension views (safe, no data changes)
2. After backfill completes, integrate category data
3. Test query performance with enriched views
4. Materialize hot paths if needed
5. Update API to use enriched views

Run: npx tsx create-enriched-dimensions.ts
  `);

  await client.close();
}

analyzeDimensions().catch(console.error);
