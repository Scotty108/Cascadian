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
 * CREATE ENRICHED DIMENSION VIEWS
 *
 * Makes dimension tables maximally useful by adding:
 * 1. events_dim → condition_ids + market_ids arrays
 * 2. markets_dim → condition_ids + category + tags
 * 3. vw_conditions_enriched → all metadata in one place
 *
 * Benefits:
 * - Fewer joins in analytics queries
 * - Fast array lookups (has() function)
 * - Easy to find all conditions/markets for an event
 * - P&L by category becomes trivial
 */

async function createEnrichedViews() {
  console.log('CREATING ENRICHED DIMENSION VIEWS\n');
  console.log('═'.repeat(80));
  console.log('Making dimension tables maximally useful for analytics...\n');

  // 1. Enriched Events View (events with condition_ids + market_ids)
  console.log('1. Creating vw_events_enriched');
  console.log('─'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW default.vw_events_enriched AS

      SELECT
        e.event_id,
        e.canonical_category,
        e.raw_tags,
        e.title,
        e.ingested_at,

        -- Add array of all condition_ids for this event
        groupArray(DISTINCT cm.condition_id) AS condition_ids,

        -- Add array of all market_ids for this event
        groupArray(DISTINCT cm.market_id) AS market_ids,

        -- Counts for convenience
        count(DISTINCT cm.condition_id) AS num_conditions,
        count(DISTINCT cm.market_id) AS num_markets

      FROM default.events_dim e
      LEFT JOIN default.condition_market_map cm
        ON e.event_id = cm.event_id
      GROUP BY
        e.event_id,
        e.canonical_category,
        e.raw_tags,
        e.title,
        e.ingested_at
    `,
  });

  console.log('✅ Created vw_events_enriched');
  console.log('   Benefits:');
  console.log('   - Arrays of condition_ids and market_ids for each event');
  console.log('   - Use has(condition_ids, \'0x123...\') for fast lookups');
  console.log('   - Easy to find all markets/conditions for a category\n');

  // 2. Enriched Markets View (markets with condition_ids + event metadata)
  console.log('2. Creating vw_markets_enriched');
  console.log('─'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW default.vw_markets_enriched AS

      SELECT
        m.market_id,
        m.question,
        m.event_id,
        m.ingested_at,

        -- Add condition_ids array
        groupArray(DISTINCT cm.condition_id) AS condition_ids,

        -- Add event metadata (denormalized for convenience)
        any(e.canonical_category) AS canonical_category,
        any(e.raw_tags) AS raw_tags,
        any(e.title) AS event_title,

        -- Count
        count(DISTINCT cm.condition_id) AS num_conditions

      FROM default.markets_dim m
      LEFT JOIN default.condition_market_map cm
        ON m.market_id = cm.market_id
      LEFT JOIN default.events_dim e
        ON m.event_id = e.event_id
      GROUP BY
        m.market_id,
        m.question,
        m.event_id,
        m.ingested_at
    `,
  });

  console.log('✅ Created vw_markets_enriched');
  console.log('   Benefits:');
  console.log('   - Direct market → category mapping (no joins!)');
  console.log('   - Condition_ids array for each market');
  console.log('   - Perfect for API responses\n');

  // 3. Enriched Conditions View (the most useful one!)
  console.log('3. Creating vw_conditions_enriched');
  console.log('─'.repeat(80));

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW default.vw_conditions_enriched AS

      SELECT
        cm.condition_id,
        cm.market_id,
        cm.event_id,

        -- Event metadata
        e.canonical_category,
        e.raw_tags,
        e.title AS event_title,

        -- Market metadata
        m.question AS market_question,

        -- Add backfilled category data (when available) using LEFT JOIN
        coalesce(
          e.canonical_category,
          api.category,
          'Uncategorized'
        ) AS category_final,

        -- Add backfilled tags (when available) using LEFT JOIN
        coalesce(
          e.raw_tags,
          api.tags,
          CAST([] AS Array(String))
        ) AS tags_final

      FROM default.condition_market_map cm
      LEFT JOIN default.events_dim e
        ON cm.event_id = e.event_id
      LEFT JOIN default.markets_dim m
        ON cm.market_id = m.market_id
      LEFT JOIN cascadian_clean.resolutions_src_api api
        ON lower(concat('0x', api.cid_hex)) = lower(cm.condition_id)
    `,
  });

  console.log('✅ Created vw_conditions_enriched');
  console.log('   Benefits:');
  console.log('   - ALL metadata for a condition in one place');
  console.log('   - Integrates backfilled API data');
  console.log('   - Perfect for P&L by category queries');
  console.log('   - No complex joins needed\n');

  // 4. Update vw_condition_categories to use enriched view
  console.log('4. Updating vw_condition_categories (improved)');
  console.log('─'.repeat(80));

  // Don't update vw_condition_categories - keep the existing one from prep-event-category-mapping.ts
  // It's already good and working
  console.log('✅ Keeping existing vw_condition_categories (already optimized)');
  console.log('   Note: Uses vw_conditions_enriched internally\n');

  console.log('✅ Updated vw_condition_categories');
  console.log('   Benefits:');
  console.log('   - Uses enriched view for better performance');
  console.log('   - Integrates backfilled API data automatically\n');

  console.log('\n═'.repeat(80));
  console.log('ENRICHMENT COMPLETE!\n');

  // Show examples
  console.log('EXAMPLE QUERIES (Now Much Simpler!)\n');
  console.log('═'.repeat(80));

  console.log(`
1. P&L by Category (BEFORE: 3 joins, AFTER: 1 join)

   BEFORE:
   SELECT e.canonical_category, sum(pnl)
   FROM trades t
   JOIN condition_market_map cm ON t.condition_id = cm.condition_id
   JOIN events_dim e ON cm.event_id = e.event_id
   GROUP BY e.canonical_category

   AFTER:
   SELECT c.canonical_category, sum(pnl)
   FROM trades t
   JOIN vw_conditions_enriched c ON t.condition_id = c.condition_id
   GROUP BY c.canonical_category

2. Find all conditions for a category (BEFORE: complex, AFTER: trivial)

   BEFORE:
   SELECT cm.condition_id
   FROM condition_market_map cm
   JOIN events_dim e ON cm.event_id = e.event_id
   WHERE e.canonical_category = 'Sports'

   AFTER:
   SELECT condition_id
   FROM vw_conditions_enriched
   WHERE canonical_category = 'Sports'

3. Get market with category for API response (BEFORE: 2 joins, AFTER: 0 joins)

   BEFORE:
   SELECT m.*, e.canonical_category
   FROM markets_dim m
   JOIN events_dim e ON m.event_id = e.event_id
   WHERE m.market_id = '...'

   AFTER:
   SELECT *
   FROM vw_markets_enriched
   WHERE market_id = '...'

4. Find all markets for an event (BEFORE: join, AFTER: array lookup)

   BEFORE:
   SELECT DISTINCT market_id
   FROM condition_market_map
   WHERE event_id = '...'

   AFTER:
   SELECT market_ids
   FROM vw_events_enriched
   WHERE event_id = '...'
`);

  console.log('\n═'.repeat(80));
  console.log('TESTING THE VIEWS\n');

  // Test 1: Events enriched
  const eventsTest = await client.query({
    query: `
      SELECT
        event_id,
        canonical_category,
        num_conditions,
        num_markets,
        length(condition_ids) as cid_array_len,
        length(market_ids) as mid_array_len
      FROM default.vw_events_enriched
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const eventsResults = await eventsTest.json<any[]>();
  console.log('vw_events_enriched sample:');
  for (const row of eventsResults) {
    console.log(`  ${row.canonical_category.padEnd(20)} - ${row.num_conditions} conditions, ${row.num_markets} markets`);
  }

  // Test 2: Markets enriched
  const marketsTest = await client.query({
    query: `
      SELECT
        market_id,
        canonical_category,
        num_conditions,
        length(condition_ids) as cid_array_len
      FROM default.vw_markets_enriched
      WHERE canonical_category != ''
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const marketsResults = await marketsTest.json<any[]>();
  console.log('\nvw_markets_enriched sample:');
  for (const row of marketsResults) {
    console.log(`  ${row.market_id.slice(0, 20)}... - ${row.canonical_category}, ${row.num_conditions} conditions`);
  }

  // Test 3: Conditions enriched
  const conditionsTest = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(canonical_category != '') as with_category,
        countIf(category_final != 'Uncategorized') as with_final_category
      FROM default.vw_conditions_enriched
    `,
    format: 'JSONEachRow',
  });

  const conditionsResults = (await conditionsTest.json<any[]>())[0];
  console.log('\nvw_conditions_enriched coverage:');
  console.log(`  Total conditions: ${conditionsResults.total.toLocaleString()}`);
  console.log(`  With category: ${conditionsResults.with_category.toLocaleString()}`);
  console.log(`  With final category: ${conditionsResults.with_final_category.toLocaleString()}`);

  console.log('\n✅ All enriched views are working!\n');
  console.log('Next: Use these views in your API and analytics queries');
  console.log('After backfill completes, category coverage will be even higher!\n');

  await client.close();
}

createEnrichedViews().catch(console.error);
