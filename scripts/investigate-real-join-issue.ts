#!/usr/bin/env tsx
/**
 * INVESTIGATION: Why are only 57k of 224k resolutions matching?
 *
 * FixedString is NOT the issue. Need to find the real cause.
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function investigateRealIssue() {
  console.log('\n🔍 INVESTIGATING REAL JOIN ISSUE\n');
  console.log('=' .repeat(80));

  // 1. Count total condition IDs in each table
  console.log('\n1️⃣ TOTAL UNIQUE CONDITION IDs IN EACH TABLE');
  console.log('-'.repeat(80));

  const resolutionCount = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id_norm) as unique_cids,
        COUNT(DISTINCT lower('0x' || toString(condition_id_norm))) as unique_cids_normalized
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });

  const resRows = await resolutionCount.json<any>();
  console.log('\nmarket_resolutions_final (with valid winners):');
  console.log(`  Total rows: ${resRows[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs (raw): ${resRows[0].unique_cids.toLocaleString()}`);
  console.log(`  Unique CIDs (normalized): ${resRows[0].unique_cids_normalized.toLocaleString()}`);

  const tradeCount = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT cid_hex) as unique_cids,
        COUNT(DISTINCT cid_hex) as unique_cids_nonempty
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
    `,
    format: 'JSONEachRow'
  });

  const tradeRows = await tradeCount.json<any>();
  console.log('\nfact_trades_clean (non-empty CIDs):');
  console.log(`  Total rows: ${tradeRows[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs: ${tradeRows[0].unique_cids.toLocaleString()}`);

  // 2. Check overlap between the two sets
  console.log('\n2️⃣ OVERLAP ANALYSIS');
  console.log('-'.repeat(80));

  const overlapQuery = `
    WITH resolution_cids AS (
      SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    ),
    trade_cids AS (
      SELECT DISTINCT cid_hex
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
    )
    SELECT
      (SELECT COUNT(*) FROM resolution_cids) as resolution_cids,
      (SELECT COUNT(*) FROM trade_cids) as trade_cids,
      COUNT(*) as overlap
    FROM resolution_cids r
    INNER JOIN trade_cids t ON r.cid_hex = t.cid_hex
  `;

  const overlap = await client.query({ query: overlapQuery, format: 'JSONEachRow' });
  const overlapRows = await overlap.json<any>();

  console.log(`\nResolution CIDs: ${overlapRows[0].resolution_cids.toLocaleString()}`);
  console.log(`Trade CIDs: ${overlapRows[0].trade_cids.toLocaleString()}`);
  console.log(`Overlap (matching): ${overlapRows[0].overlap.toLocaleString()}`);
  console.log(`\nMissing from trades: ${(overlapRows[0].resolution_cids - overlapRows[0].overlap).toLocaleString()}`);
  console.log(`Missing from resolutions: ${(overlapRows[0].trade_cids - overlapRows[0].overlap).toLocaleString()}`);

  // 3. Sample non-matching CIDs from both sides
  console.log('\n3️⃣ SAMPLE NON-MATCHING CIDs');
  console.log('-'.repeat(80));

  // CIDs in resolutions but not in trades
  const missingInTrades = await client.query({
    query: `
      WITH resolution_cids AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL AND payout_denominator > 0
      ),
      trade_cids AS (
        SELECT DISTINCT cid_hex
        FROM cascadian_clean.fact_trades_clean
        WHERE cid_hex != ''
      )
      SELECT r.cid_hex
      FROM resolution_cids r
      LEFT JOIN trade_cids t ON r.cid_hex = t.cid_hex
      WHERE t.cid_hex IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const missingInTradesRows = await missingInTrades.json<any>();
  console.log('\nCIDs in resolutions but NOT in trades (sample):');
  missingInTradesRows.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.cid_hex}`);
  });

  // CIDs in trades but not in resolutions
  const missingInResolutions = await client.query({
    query: `
      WITH resolution_cids AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL AND payout_denominator > 0
      ),
      trade_cids AS (
        SELECT DISTINCT cid_hex
        FROM cascadian_clean.fact_trades_clean
        WHERE cid_hex != ''
      )
      SELECT t.cid_hex
      FROM trade_cids t
      LEFT JOIN resolution_cids r ON t.cid_hex = r.cid_hex
      WHERE r.cid_hex IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const missingInResolutionsRows = await missingInResolutions.json<any>();
  console.log('\nCIDs in trades but NOT in resolutions (sample):');
  missingInResolutionsRows.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.cid_hex}`);
  });

  // 4. Check if it's a data freshness issue
  console.log('\n4️⃣ DATA FRESHNESS CHECK');
  console.log('-'.repeat(80));

  const freshnessQuery = `
    SELECT
      'market_resolutions_final' as table_name,
      COUNT(*) as total_rows,
      MIN(inserted_at) as earliest,
      MAX(inserted_at) as latest
    FROM default.market_resolutions_final
    WHERE winning_index IS NOT NULL

    UNION ALL

    SELECT
      'fact_trades_clean' as table_name,
      COUNT(*) as total_rows,
      MIN(block_timestamp) as earliest,
      MAX(block_timestamp) as latest
    FROM cascadian_clean.fact_trades_clean
  `;

  const freshness = await client.query({ query: freshnessQuery, format: 'JSONEachRow' });
  const freshnessRows = await freshness.json<any>();

  console.log('\nData time ranges:');
  freshnessRows.forEach((row: any) => {
    console.log(`\n${row.table_name}:`);
    console.log(`  Total rows: ${row.total_rows.toLocaleString()}`);
    console.log(`  Earliest: ${row.earliest}`);
    console.log(`  Latest: ${row.latest}`);
  });

  // 5. Check if there are markets without condition_ids in trades
  console.log('\n5️⃣ EMPTY CONDITION ID ANALYSIS');
  console.log('-'.repeat(80));

  const emptyCheck = await client.query({
    query: `
      SELECT
        SUM(CASE WHEN cid_hex = '' THEN 1 ELSE 0 END) as empty_cid_count,
        SUM(CASE WHEN cid_hex != '' THEN 1 ELSE 0 END) as nonempty_cid_count,
        COUNT(*) as total
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });

  const emptyRows = await emptyCheck.json<any>();
  console.log('\nfact_trades_clean condition ID status:');
  console.log(`  Empty CIDs: ${emptyRows[0].empty_cid_count.toLocaleString()}`);
  console.log(`  Non-empty CIDs: ${emptyRows[0].nonempty_cid_count.toLocaleString()}`);
  console.log(`  Total trades: ${emptyRows[0].total.toLocaleString()}`);
  console.log(`  Empty CID %: ${((emptyRows[0].empty_cid_count / emptyRows[0].total) * 100).toFixed(2)}%`);

  // 6. Check specific format mismatches
  console.log('\n6️⃣ FORMAT VALIDATION');
  console.log('-'.repeat(80));

  const formatCheck = await client.query({
    query: `
      SELECT
        length(cid_hex) as cid_length,
        COUNT(*) as count,
        any(cid_hex) as example
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
      GROUP BY length(cid_hex)
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const formatRows = await formatCheck.json<any>();
  console.log('\nfact_trades_clean CID lengths:');
  formatRows.forEach((row: any) => {
    console.log(`  Length ${row.cid_length}: ${row.count.toLocaleString()} trades (example: ${row.example.substring(0, 20)}...)`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ INVESTIGATION COMPLETE\n');

  await client.close();
}

investigateRealIssue().catch(console.error);
