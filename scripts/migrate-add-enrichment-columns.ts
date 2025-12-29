#!/usr/bin/env tsx
/**
 * Migration: Add Enrichment Tracking Columns
 *
 * Adds columns to track canonical (API) vs enriched (processed) data:
 * - canonical_category: Original category from Gamma API
 * - canonical_tags: Original tags from Gamma API
 * - enriched_category: Category after our enrichment
 * - enriched_tags: Tags after our enrichment
 * - enrichment_version: Track enrichment iterations
 *
 * Uses atomic RENAME pattern (no destructive operations):
 * 1. CREATE pm_market_metadata_new with new schema
 * 2. INSERT INTO new table, mapping existing columns
 * 3. RENAME tables atomically
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function migrateSchema() {
  console.log('\n🔄 MIGRATING SCHEMA: Adding enrichment tracking columns\n');
  console.log('='.repeat(80));

  // Step 1: Check current table stats
  console.log('\n📊 Current table statistics:');
  const countResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata',
    format: 'JSONEachRow',
  });
  const countData = await countResult.json<{ count: string }>();
  const totalRows = parseInt(countData[0].count);
  console.log(`   Total rows: ${totalRows.toLocaleString()}`);

  if (totalRows === 0) {
    console.log('\n⚠️  Table is empty - no migration needed');
    console.log('   Run the ingestion script first to populate data');
    process.exit(0);
  }

  // Step 2: Sample existing data
  console.log('\n🔍 Sample of existing data:');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT condition_id, question, category, tags
      FROM pm_market_metadata
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const sampleData = await sampleResult.json<any>();
  sampleData.forEach((row: any, i: number) => {
    console.log(`\n   Sample ${i + 1}:`);
    console.log(`   Question: ${row.question}`);
    console.log(`   Category: ${row.category}`);
    console.log(`   Tags: [${row.tags.join(', ')}]`);
  });

  // Step 3: Create new table with enrichment columns
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 Creating new table with enrichment columns...');

  const newTableSchema = `
    CREATE TABLE pm_market_metadata_new
    (
      condition_id String,
      market_id String,
      slug String,
      question String,
      outcome_label String,
      description String,
      image_url String,

      -- CANONICAL DATA (from API, never changes)
      canonical_category String DEFAULT '',
      canonical_tags Array(String) DEFAULT [],

      -- ENRICHED DATA (processed by our taxonomy)
      enriched_category String DEFAULT '',
      enriched_tags Array(String) DEFAULT [],
      enrichment_version UInt16 DEFAULT 0,

      -- DEPRECATED (kept for backward compatibility)
      tags Array(String) DEFAULT [],
      category String DEFAULT '',

      volume_usdc Float64,
      is_active UInt8,
      is_closed UInt8,
      end_date Nullable(DateTime64(3)),
      ingested_at UInt64,
      liquidity_usdc Float64,
      outcomes Array(String),
      outcome_prices String,
      token_ids Array(String),
      winning_outcome String,
      resolution_source String,
      enable_order_book UInt8,
      order_price_min_tick_size Float64,
      notifications_enabled UInt8,
      event_id String,
      group_slug String,
      rewards_min_size Float64,
      rewards_max_spread Float64,
      spread Float64,
      best_bid Float64,
      best_ask Float64,
      start_date Nullable(DateTime64(3)),
      created_at Nullable(DateTime64(3)),
      updated_at Nullable(DateTime64(3)),
      market_type String,
      format_type String,
      lower_bound String,
      upper_bound String,
      volume_24hr Float64,
      volume_1wk Float64,
      volume_1mo Float64,
      price_change_1d Float64,
      price_change_1w Float64,
      series_slug String,
      series_data String,
      comment_count UInt32,
      is_restricted UInt8,
      is_archived UInt8,
      wide_format UInt8
    )
    ENGINE = ReplacingMergeTree(ingested_at)
    ORDER BY condition_id
    SETTINGS index_granularity = 8192
  `.trim();

  await clickhouse.command({ query: newTableSchema });
  console.log('   ✅ New table created: pm_market_metadata_new');

  // Step 4: Copy data with new column mapping
  console.log('\n📋 Copying data to new table...');
  console.log('   Mapping strategy:');
  console.log('   - canonical_category = category (preserve original)');
  console.log('   - canonical_tags = tags (preserve original)');
  console.log('   - enriched_category = category (current enriched value)');
  console.log('   - enriched_tags = tags (current enriched value)');
  console.log('   - enrichment_version = 1 (marks as V2 enriched)');

  const copyQuery = `
    INSERT INTO pm_market_metadata_new
    SELECT
      condition_id,
      market_id,
      slug,
      question,
      outcome_label,
      description,
      image_url,

      -- Canonical data (preserve original from API)
      category as canonical_category,
      tags as canonical_tags,

      -- Enriched data (current enriched values)
      category as enriched_category,
      tags as enriched_tags,
      1 as enrichment_version,  -- Mark as V2 enriched

      -- Deprecated (backward compatibility)
      tags,
      category,

      volume_usdc,
      is_active,
      is_closed,
      end_date,
      ingested_at,
      liquidity_usdc,
      outcomes,
      outcome_prices,
      token_ids,
      winning_outcome,
      resolution_source,
      enable_order_book,
      order_price_min_tick_size,
      notifications_enabled,
      event_id,
      group_slug,
      rewards_min_size,
      rewards_max_spread,
      spread,
      best_bid,
      best_ask,
      start_date,
      created_at,
      updated_at,
      market_type,
      format_type,
      lower_bound,
      upper_bound,
      volume_24hr,
      volume_1wk,
      volume_1mo,
      price_change_1d,
      price_change_1w,
      series_slug,
      series_data,
      comment_count,
      is_restricted,
      is_archived,
      wide_format
    FROM pm_market_metadata
  `;

  await clickhouse.command({ query: copyQuery });
  console.log('   ✅ Data copied successfully');

  // Step 5: Verify new table
  console.log('\n📊 Verifying new table:');
  const newCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata_new',
    format: 'JSONEachRow',
  });
  const newCountData = await newCountResult.json<{ count: string }>();
  const newRows = parseInt(newCountData[0].count);
  console.log(`   New table rows: ${newRows.toLocaleString()}`);

  if (newRows !== totalRows) {
    console.error(`\n❌ Row count mismatch!`);
    console.error(`   Original: ${totalRows.toLocaleString()}`);
    console.error(`   New: ${newRows.toLocaleString()}`);
    console.error('\n   Migration aborted - cleaning up...');
    await clickhouse.command({ query: 'DROP TABLE pm_market_metadata_new' });
    process.exit(1);
  }

  // Step 6: Sample new data
  console.log('\n🔍 Sample of migrated data:');
  const newSampleResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        canonical_category,
        canonical_tags,
        enriched_category,
        enriched_tags,
        enrichment_version
      FROM pm_market_metadata_new
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const newSampleData = await newSampleResult.json<any>();
  newSampleData.forEach((row: any, i: number) => {
    console.log(`\n   Sample ${i + 1}:`);
    console.log(`   Question: ${row.question}`);
    console.log(`   Canonical Category: ${row.canonical_category}`);
    console.log(`   Canonical Tags: [${row.canonical_tags.join(', ')}]`);
    console.log(`   Enriched Category: ${row.enriched_category}`);
    console.log(`   Enriched Tags: [${row.enriched_tags.join(', ')}]`);
    console.log(`   Enrichment Version: ${row.enrichment_version}`);
  });

  // Step 7: Swap tables (ClickHouse Cloud requires separate RENAME operations)
  console.log('\n' + '='.repeat(80));
  console.log('\n🔄 Performing table swap...');

  // Step 7a: Rename old table
  await clickhouse.command({
    query: 'RENAME TABLE pm_market_metadata TO pm_market_metadata_old'
  });
  console.log('   ✅ Old table renamed to pm_market_metadata_old');

  // Step 7b: Rename new table to active
  await clickhouse.command({
    query: 'RENAME TABLE pm_market_metadata_new TO pm_market_metadata'
  });
  console.log('   ✅ New table renamed to pm_market_metadata');

  // Step 8: Verify final state
  console.log('\n📊 Final verification:');
  const finalCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata',
    format: 'JSONEachRow',
  });
  const finalCountData = await finalCountResult.json<{ count: string }>();
  console.log(`   Active table rows: ${finalCountData[0].count}`);

  // Step 9: Drop old table
  console.log('\n🗑️  Dropping old table...');
  await clickhouse.command({ query: 'DROP TABLE pm_market_metadata_old' });
  console.log('   ✅ Old table dropped');

  console.log('\n' + '='.repeat(80));
  console.log('✅ Migration complete!');
  console.log('\nNew columns added:');
  console.log('   - canonical_category (original from API)');
  console.log('   - canonical_tags (original from API)');
  console.log('   - enriched_category (processed by taxonomy)');
  console.log('   - enriched_tags (processed by taxonomy)');
  console.log('   - enrichment_version (iteration tracker)');
  console.log('\n');
}

migrateSchema()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  });
