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

async function debugEnrichedViews() {
  console.log('DEBUGGING ENRICHED VIEWS\n');
  console.log('═'.repeat(80));

  // Check condition_market_map
  console.log('\n1. Checking condition_market_map table...\n');

  const mapCount = await client.query({
    query: 'SELECT count() as cnt FROM default.condition_market_map',
    format: 'JSONEachRow',
  });
  const mapResult = (await mapCount.json<any[]>())[0];
  console.log(`  Total mappings: ${mapResult.cnt.toLocaleString()}`);

  const mapSample = await client.query({
    query: 'SELECT * FROM default.condition_market_map LIMIT 3',
    format: 'JSONEachRow',
  });
  const mapSamples = await mapSample.json<any[]>();
  console.log(`  Sample data (${mapSamples.length} rows):`);
  for (const row of mapSamples) {
    console.log(`    condition_id: ${row.condition_id?.slice(0, 20)}...`);
    console.log(`    market_id: ${row.market_id?.slice(0, 20)}...`);
    console.log(`    event_id: ${row.event_id}`);
    console.log();
  }

  // Check events_dim
  console.log('\n2. Checking events_dim table...\n');

  const eventsCount = await client.query({
    query: 'SELECT count() as cnt FROM default.events_dim',
    format: 'JSONEachRow',
  });
  const eventsResult = (await eventsCount.json<any[]>())[0];
  console.log(`  Total events: ${eventsResult.cnt.toLocaleString()}`);

  const eventsSample = await client.query({
    query: 'SELECT event_id, canonical_category, title FROM default.events_dim LIMIT 3',
    format: 'JSONEachRow',
  });
  const eventsSamples = await eventsSample.json<any[]>();
  console.log(`  Sample events:`);
  for (const row of eventsSamples) {
    console.log(`    event_id: ${row.event_id}`);
    console.log(`    category: ${row.canonical_category}`);
    console.log(`    title: ${row.title}`);
    console.log();
  }

  // Check if join works
  console.log('\n3. Testing join between events_dim and condition_market_map...\n');

  const joinTest = await client.query({
    query: `
      SELECT
        e.event_id,
        e.canonical_category,
        count(DISTINCT cm.condition_id) as condition_count,
        count(DISTINCT cm.market_id) as market_count
      FROM default.events_dim e
      LEFT JOIN default.condition_market_map cm
        ON e.event_id = cm.event_id
      GROUP BY e.event_id, e.canonical_category
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const joinResults = await joinTest.json<any[]>();
  console.log(`  Join results (first 5 events):`);
  for (const row of joinResults) {
    console.log(`    event_id: ${row.event_id}`);
    console.log(`    category: ${row.canonical_category}`);
    console.log(`    conditions: ${row.condition_count}`);
    console.log(`    markets: ${row.market_count}`);
    console.log();
  }

  // Check view definition
  console.log('\n4. Checking vw_events_enriched view...\n');

  const viewTest = await client.query({
    query: `
      SELECT
        event_id,
        canonical_category,
        num_conditions,
        num_markets,
        length(condition_ids) as cid_array_len,
        length(market_ids) as mid_array_len
      FROM default.vw_events_enriched
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const viewResults = await viewTest.json<any[]>();
  console.log(`  View results (first 5 events):`);
  for (const row of viewResults) {
    console.log(`    event_id: ${row.event_id}`);
    console.log(`    category: ${row.canonical_category}`);
    console.log(`    num_conditions: ${row.num_conditions}`);
    console.log(`    num_markets: ${row.num_markets}`);
    console.log(`    condition_ids array length: ${row.cid_array_len}`);
    console.log(`    market_ids array length: ${row.mid_array_len}`);
    console.log();
  }

  console.log('\n═'.repeat(80));
  console.log('DIAGNOSIS\n');

  if (mapResult.cnt === 0) {
    console.log('❌ PROBLEM: condition_market_map is EMPTY');
    console.log('   This is why the enriched views show empty arrays');
    console.log('   The table needs to be populated with condition→market→event mappings\n');
  } else if (joinResults.every(r => r.condition_count === 0)) {
    console.log('❌ PROBLEM: event_id mismatch between tables');
    console.log('   condition_market_map has data, but event_ids don\'t match events_dim');
    console.log('   Need to check event_id format/normalization\n');
  } else {
    console.log('✅ Data looks good - enriched views should be working');
  }

  await client.close();
}

debugEnrichedViews().catch(console.error);
